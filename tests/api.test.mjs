// End-to-end tests against a real server on an ephemeral port, with a throwaway data folder.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOMS } from "../assets/js/data.js";
import { addDays, isRoomFree } from "../assets/js/engine.js";
import { createApp } from "../server/app.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-11T10:00:00Z");
const TODAY = "2026-10-11";
const guest = { firstName: "Mario", lastName: "Rossi", email: "mario@example.com", phone: "+39 333 1234567", whatsapp: true, lang: "en" };

let app;
let base;
let port;

before(async () => {
  app = await createApp({ rootDir: ROOT, dataDir: await mkdtemp(join(tmpdir(), "fbr-api-")), env: {}, now: () => NOW });
  port = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
  await app.pull();
  await app.sync();
});
after(() => app.close());

const getJson = async (path) => (await fetch(base + path)).json();
const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const availability = () => getJson("/api/availability");
const outbox = async () => (await getJson("/api/admin/outbox")).jobs;
const adminBookings = async () => (await getJson("/api/admin/bookings")).bookings;

async function findFree({ fromDay = 5, nights = 2 } = {}) {
  const { bookings } = await availability();
  for (let d = fromDay; d < 140; d++) {
    for (const room of ROOMS) {
      const checkIn = addDays(TODAY, d);
      const checkOut = addDays(checkIn, nights);
      if (isRoomFree(room.id, checkIn, checkOut, bookings)) return { roomId: room.id, checkIn, checkOut };
    }
  }
  throw new Error("no free window in the seeded calendar");
}
const bookingInput = (slot, extra = {}) => ({ roomIds: [slot.roomId], checkIn: slot.checkIn, checkOut: slot.checkOut, adults: 2, guest, ...extra });

// Raw request, so the test controls the Host header and the exact path sent.
const raw = ({ path = "/", method = "GET", headers = {}, body, host = `127.0.0.1:${port}` }) =>
  new Promise((resolveRaw, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolveRaw({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });

test("the public calendar shows availability only, never guest details", async () => {
  const data = await availability();
  assert.equal(data.today, TODAY);
  assert.ok(data.bookings.length > 20, "Booking.com reservations were imported through the iCal sync");
  for (const b of data.bookings) assert.deepEqual(Object.keys(b).sort(), ["checkIn", "checkOut", "roomId", "status"]);
});

test("a direct booking is stored, blocks the dates and queues the WhatsApp journey", async () => {
  const slot = await findFree();
  const res = await post("/api/bookings", bookingInput(slot));
  assert.equal(res.status, 201);
  const { code, bookings, total } = await res.json();
  assert.match(code, /^FBR-[A-Z0-9]{4}$/);
  assert.equal(bookings[0].channel, "Sito web");
  assert.ok(total > 0);
  const { bookings: after } = await availability();
  assert.equal(isRoomFree(slot.roomId, slot.checkIn, slot.checkOut, after), false);
  await app.tick();
  const jobs = (await outbox()).filter((j) => j.code === code);
  assert.deepEqual(jobs.map((j) => j.kind).sort(), ["booking_confirmed", "checkin_day", "checkout_thanks", "host_new_booking", "pre_arrival"]);
  const confirmation = jobs.find((j) => j.kind === "booking_confirmed");
  assert.equal(confirmation.status, "sent");
  assert.equal(confirmation.mode, "dry-run");
  assert.match(confirmation.text, /^Hi Mario, your booking/);
});

test("the same dates cannot be sold twice, and a bad request stores nothing", async () => {
  const [taken] = (await adminBookings()).filter((b) => b.channel === "Sito web" && !b.seeded);
  const again = await post("/api/bookings", bookingInput({ roomId: taken.roomId, checkIn: taken.checkIn, checkOut: taken.checkOut }));
  assert.equal(again.status, 422);
  assert.equal((await again.json()).fields.rooms, "roomTaken");
  const before = (await adminBookings()).length;
  const bad = await post("/api/bookings", bookingInput(await findFree({ fromDay: 30 }), { guest: { ...guest, email: "nope" } }));
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).fields.email, "email");
  assert.equal((await adminBookings()).length, before);
});

test("without WhatsApp opt-in the guest gets nothing, the host still gets the alert", async () => {
  const res = await post("/api/bookings", bookingInput(await findFree({ fromDay: 40 }), { guest: { ...guest, whatsapp: false } }));
  const { code } = await res.json();
  await app.tick();
  assert.deepEqual((await outbox()).filter((j) => j.code === code).map((j) => j.kind), ["host_new_booking"]);
});

test("the calendar feed we give to Booking.com lists our stays, without names and without its own", async () => {
  const [mine] = (await adminBookings()).filter((b) => b.channel === "Sito web" && !b.seeded);
  const feed = await (await fetch(`${base}/ical/${mine.roomId}.ics?exclude=Booking.com`)).text();
  assert.match(feed, new RegExp(`DTSTART;VALUE=DATE:${mine.checkIn.replaceAll("-", "")}`));
  assert.doesNotMatch(feed, /Rossi|mario@/);
  const all = await (await fetch(`${base}/ical/economy.ics`)).text();
  const without = await (await fetch(`${base}/ical/economy.ics?exclude=Booking.com`)).text();
  assert.ok(all.split("BEGIN:VEVENT").length > without.split("BEGIN:VEVENT").length);
  assert.equal((await fetch(`${base}/ical/suite.ics`)).status, 404);
});

test("a Booking.com reservation that slips in before it re-reads our calendar is caught and reported", async () => {
  const slot = await findFree({ fromDay: 60, nights: 3 });
  assert.equal((await post("/api/bookings", bookingInput(slot, { guest: { ...guest, whatsapp: false } }))).status, 201);
  const reserve = await post("/api/admin/mock/reserve", { roomId: slot.roomId, start: slot.checkIn, end: slot.checkOut });
  assert.equal(reserve.status, 201, "Booking.com had not pulled our calendar yet, so it sells the room");
  await app.sync();
  const clash = (await adminBookings()).find((b) => b.channel === "Booking.com" && b.roomId === slot.roomId && b.checkIn === slot.checkIn);
  assert.equal(clash.conflict, true);
  assert.ok((await outbox()).some((j) => j.kind === "host_conflict" && j.status === "sent" && j.text.includes("ATTENZIONE")));
  assert.equal((await post("/api/admin/mock/pull", {})).status, 200);
  const retry = await post("/api/admin/mock/reserve", { roomId: slot.roomId, start: slot.checkIn, end: slot.checkOut });
  assert.equal(retry.status, 409, "after the pull Booking.com sees the block and refuses");
});

test("the host can cancel a direct booking but not one that belongs to a channel", async () => {
  const list = await adminBookings();
  const mine = list.find((b) => b.channel === "Sito web" && !b.seeded && b.status === "confermata");
  const res = await post(`/api/admin/bookings/${mine.code}/cancel`, {});
  assert.deepEqual(await res.json(), { cancelled: 1 });
  const { bookings } = await availability();
  assert.equal(isRoomFree(mine.roomId, mine.checkIn, mine.checkOut, bookings), true);
  assert.ok((await outbox()).filter((j) => j.code === mine.code && j.audience === "guest" && j.kind !== "booking_confirmed").every((j) => j.status === "cancelled"));
  const ota = list.find((b) => b.sourceUid);
  assert.equal((await post(`/api/admin/bookings/${ota.code}/cancel`, {})).status, 409);
  assert.equal((await post("/api/admin/bookings/NOPE-0000/cancel", {})).status, 404);
});

test("advancing the demo clock sends the instructions that were waiting for their day", async () => {
  const slot = await findFree({ fromDay: 8 });
  const { code } = await (await post("/api/bookings", bookingInput(slot))).json();
  const pre = async () => (await outbox()).find((j) => j.code === code && j.kind === "pre_arrival");
  assert.equal((await pre()).status, "scheduled");
  assert.equal((await post("/api/admin/demo/clock", { days: 99 })).status, 400);
  assert.equal((await post("/api/admin/demo/clock", { days: 6 })).status, 200);
  assert.equal((await availability()).today, addDays(TODAY, 6));
  assert.equal((await pre()).status, "sent");
  assert.equal((await post("/api/admin/demo/clock", { reset: true })).status, 200);
  assert.equal((await availability()).today, TODAY);
});

test("the server only talks to its own machine and rejects forged or malformed requests", async () => {
  assert.equal((await raw({ path: "/api/availability", host: "evil.example" })).status, 403);
  const body = JSON.stringify({});
  const json = { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) };
  assert.equal((await raw({ path: "/api/bookings", method: "POST", headers: { ...json, origin: "http://evil.example" }, body })).status, 403);
  assert.equal((await raw({ path: "/api/bookings", method: "POST", headers: { ...json, origin: "null" }, body })).status, 403);
  assert.equal((await raw({ path: "/api/bookings", method: "POST", headers: { "content-type": "text/plain" }, body })).status, 415);
  assert.equal((await raw({ path: "/api/bookings", method: "POST", headers: { "content-type": "application/json" }, body: "{nope" })).status, 400);
  assert.equal((await raw({ path: "/api/bookings", method: "POST", headers: { "content-type": "application/json" }, body: "[]" })).status, 400);
  assert.equal((await raw({ path: "/api/bookings", method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(70_000) })).status, 413);
});

test("only the site's own pages and assets are served", async () => {
  for (const path of ["/server/app.mjs", "/data/db.json", "/.env", "/package.json", "/.git/config", "/tests/api.test.mjs", "/assets/../server/app.mjs", "/assets/%2e%2e/server/app.mjs", "/assets/..%2fserver/app.mjs", "/assets/nope.js", "/assets/"]) {
    assert.equal((await raw({ path })).status, 404, path);
  }
  const js = await raw({ path: "/assets/js/engine.js" });
  assert.equal(js.status, 200);
  assert.match(js.headers["content-type"], /javascript/);
  assert.equal(js.headers["x-content-type-options"], "nosniff");
  assert.equal((await raw({ path: "/assets/js/engine.js", method: "HEAD" })).text, "");
});

test("remote mode refuses to start without an admin token and then protects the console", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "fbr-remote-"));
  await assert.rejects(createApp({ rootDir: ROOT, dataDir, env: { ALLOW_REMOTE: "1" }, now: () => NOW }), /ADMIN_TOKEN/);
  const remote = await createApp({ rootDir: ROOT, dataDir, env: { ALLOW_REMOTE: "1", ADMIN_TOKEN: "s3cret-token" }, now: () => NOW });
  const remotePort = await remote.listen(0);
  try {
    const url = `http://127.0.0.1:${remotePort}/api/admin/bookings`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { "x-admin-token": "wrong-token!" } })).status, 401);
    assert.equal((await fetch(url, { headers: { "x-admin-token": "s3cret-token" } })).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${remotePort}/api/availability`)).status, 200);
  } finally {
    await remote.close();
  }
});
