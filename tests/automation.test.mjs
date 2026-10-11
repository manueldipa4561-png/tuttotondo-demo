import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBookings } from "../assets/js/engine.js";
import { openDb } from "../server/db.mjs";
import { TEMPLATES } from "../assets/js/api/templates.js";
import {
  accessCode, cancelGuestJobs, cloudPayload, deliver, metaText, normalizePhone, render, runDue, scheduleJobs, whatsappMode,
} from "../assets/js/api/whatsapp.js";

const guest = { firstName: "Mario", lastName: "Rossi", email: "mario@example.com", phone: "333 1234567", lang: "it", whatsapp: true };
const rows = (overrides = {}) =>
  buildBookings({ roomIds: ["bath"], checkIn: "2027-03-29", checkOut: "2027-03-31", adults: 2, guest, ...overrides }, { code: "TTD-TEST", createdAt: "2027-03-01T10:00:00.000Z" });
const NOW = Date.parse("2027-03-01T10:00:00Z");
const kinds = (jobs) => jobs.map((j) => j.kind);

test("phone numbers are normalised to digits with a country code", () => {
  assert.equal(normalizePhone("333 1234567"), "393331234567");
  assert.equal(normalizePhone("+39 333 123 4567"), "393331234567");
  assert.equal(normalizePhone("0044 7700 900123"), "447700900123");
  assert.equal(normalizePhone("+44 (7700) 900-123"), "447700900123");
  assert.equal(normalizePhone("12"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(undefined), null);
});

test("an opted-in guest gets the full message journey, the host gets an alert", () => {
  const jobs = scheduleJobs(rows(), { nowMs: NOW });
  assert.deepEqual(kinds(jobs), ["booking_confirmed", "pre_arrival", "checkin_day", "checkout_thanks", "host_new_booking"]);
  const at = Object.fromEntries(jobs.map((j) => [j.kind, j.sendAt]));
  assert.equal(at.booking_confirmed, new Date(NOW).toISOString());
  assert.equal(at.pre_arrival, "2027-03-27T09:00:00.000Z"); // 10:00 Rome, two days before, still winter time
  assert.equal(at.checkin_day, "2027-03-29T07:00:00.000Z"); // 09:00 Rome, after the clocks went forward (UTC+2)
  assert.equal(at.checkout_thanks, "2027-03-31T09:30:00.000Z");
  assert.ok(jobs.every((j) => j.status === "scheduled" && j.attempts === 0));
  assert.equal(jobs.find((j) => j.kind === "host_new_booking").audience, "host");
  assert.equal(jobs[0].to, "393331234567");
});

test("a last-minute booking skips the messages whose time has already passed", () => {
  const jobs = scheduleJobs(rows(), { nowMs: Date.parse("2027-03-28T12:00:00Z") });
  assert.deepEqual(kinds(jobs), ["booking_confirmed", "checkin_day", "checkout_thanks", "host_new_booking"]);
});

test("without WhatsApp opt-in nothing is sent to the guest", () => {
  const jobs = scheduleJobs(rows({ guest: { ...guest, whatsapp: false } }), { nowMs: NOW });
  assert.deepEqual(kinds(jobs), ["host_new_booking"]);
});

test("guests who wrote in English get English messages, the host always gets Italian", () => {
  const jobs = scheduleJobs(rows({ guest: { ...guest, lang: "en" } }), { nowMs: NOW });
  assert.match(jobs[0].text, /Hi Mario, your booking TTD-TEST/);
  assert.equal(jobs[0].lang, "en");
  assert.equal(jobs.at(-1).lang, "it");
});

test("every template is complete in both languages and maps to Meta's positional variables", () => {
  const jobs = [...scheduleJobs(rows(), { nowMs: NOW }), ...scheduleJobs(rows({ guest: { ...guest, lang: "en" } }), { nowMs: NOW })];
  for (const job of jobs) {
    assert.doesNotMatch(job.text, /\{\w+\}|undefined/, `${job.kind} (${job.lang}) has an unresolved placeholder`);
    assert.equal(cloudPayload(job).template.components[0].parameters.length, TEMPLATES[job.kind].order.length);
  }
  for (const [kind, t] of Object.entries(TEMPLATES)) {
    for (const lang of ["it", "en"]) {
      const used = [...new Set([...t[lang].matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
      assert.deepEqual(used, [...t.order].sort(), `${kind}.${lang}: placeholders and "order" differ`);
      assert.doesNotMatch(metaText(kind, lang), /\{[a-z]/i);
      assert.match(metaText(kind, lang), /\{\{1\}\}/);
      assert.doesNotMatch(t[lang], /^\{|\}$/, `${kind}.${lang}: Meta rejects templates that start or end with a variable`);
    }
  }
  assert.equal(render("Ciao {name}", { name: "Mario" }), "Ciao Mario");
});

test("self check-in: the instructions and the check-in-day message carry the same demo door code, in both languages", () => {
  const code = accessCode("TTD-TEST");
  assert.match(code, /^\d{4}$/);
  assert.equal(accessCode("TTD-TEST"), code, "same booking, same code");
  assert.notEqual(accessCode("TTD-OTHER"), code);
  for (const lang of ["it", "en"]) {
    const jobs = scheduleJobs(rows({ guest: { ...guest, lang } }), { nowMs: NOW });
    for (const kind of ["pre_arrival", "checkin_day"]) {
      const job = jobs.find((j) => j.kind === kind);
      assert.equal(job.vars.accessCode, code);
      assert.ok(job.text.includes(code), `${kind} (${lang}) shows the door code`);
      assert.ok(TEMPLATES[kind].order.includes("accessCode"), `${kind} maps the code to a Meta variable`);
    }
  }
});

test("cancelling a booking cancels its pending guest messages only", () => {
  const jobs = scheduleJobs(rows(), { nowMs: NOW }).map((j) => (j.kind === "booking_confirmed" ? { ...j, status: "sent" } : j));
  const after = cancelGuestJobs(jobs, "TTD-TEST");
  assert.deepEqual(after.map((j) => j.status), ["sent", "cancelled", "cancelled", "cancelled", "scheduled"]);
  assert.deepEqual(cancelGuestJobs(jobs, "OTHER").map((j) => j.status), jobs.map((j) => j.status));
});

const noNetwork = () => assert.fail("demo mode must not use the network");
const job = scheduleJobs(rows(), { nowMs: NOW })[0];

test("demo mode writes to the outbox without any network call", async () => {
  assert.equal(whatsappMode({}), "dry-run");
  assert.deepEqual(await deliver(job, { env: {}, fetchImpl: noNetwork }), { mode: "dry-run" });
  assert.deepEqual(await deliver(job, { env: { WHATSAPP_TOKEN: "t" }, fetchImpl: noNetwork }), { mode: "dry-run" }); // incomplete config
});

test("cloud mode posts the approved template with the token in a header", async () => {
  const env = { WHATSAPP_TOKEN: "secret", WHATSAPP_PHONE_ID: "123", WHATSAPP_API_VERSION: "v99.0" };
  let call;
  const fetchImpl = async (url, init) => {
    call = { url, init };
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.1" }] }) };
  };
  assert.equal(whatsappMode(env), "cloud");
  assert.deepEqual(await deliver(job, { env, fetchImpl }), { mode: "cloud", providerId: "wamid.1" });
  assert.equal(call.url, "https://graph.facebook.com/v99.0/123/messages");
  assert.equal(call.init.headers.authorization, "Bearer secret");
  const body = JSON.parse(call.init.body);
  assert.equal(body.to, "393331234567");
  assert.equal(body.template.name, "ttd_booking_confirmed");
  assert.equal(body.template.language.code, "it");
  assert.doesNotMatch(call.init.body, /secret/);
  assert.deepEqual(await deliver({ ...job, seeded: true }, { env, fetchImpl: noNetwork }), { mode: "demo" }); // seeded jobs never leave the machine
});

async function freshDb(outbox) {
  const dir = await mkdtemp(join(tmpdir(), "ttd-wa-"));
  return openDb(join(dir, "db.json"), () => ({ bookings: [], outbox, channels: {}, mock: { reservations: [], seen: {}, lastPull: null }, clockOffsetMs: 0 }));
}

test("runDue sends what is due and leaves the future alone", async () => {
  const jobs = scheduleJobs(rows(), { nowMs: NOW });
  const db = await freshDb(jobs);
  assert.equal(await runDue({ db, nowMs: NOW, env: {}, fetchImpl: noNetwork }), 2); // confirmation + host alert
  const by = Object.fromEntries(db.get().outbox.map((j) => [j.kind, j]));
  assert.equal(by.booking_confirmed.status, "sent");
  assert.equal(by.booking_confirmed.mode, "dry-run");
  assert.equal(by.host_new_booking.status, "sent");
  assert.equal(by.pre_arrival.status, "scheduled");
  assert.equal(await runDue({ db, nowMs: Date.parse("2027-03-27T09:00:01Z"), env: {}, fetchImpl: noNetwork }), 1);
  assert.equal(db.get().outbox.find((j) => j.kind === "pre_arrival").status, "sent");
});

test("a failing send is retried, then reported as failed (never silently dropped)", async () => {
  const env = { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "1", WHATSAPP_API_VERSION: "v1.0" };
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "template not approved" } }) });
  const db = await freshDb([{ ...job, sendAt: new Date(NOW).toISOString() }]);
  let now = NOW;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await runDue({ db, nowMs: now, env, fetchImpl });
    const [j] = db.get().outbox;
    assert.equal(j.attempts, attempt);
    assert.match(j.error, /template not approved/);
    assert.equal(j.status, attempt === 3 ? "failed" : "scheduled");
    now = Date.parse(j.sendAt) + 1;
  }
  assert.equal(await runDue({ db, nowMs: now + 3_600_000, env, fetchImpl }), 0);
});
