import { randomUUID } from "node:crypto";
import { PROPERTY, roomById } from "../assets/js/data.js";
import { addDays, fmtDate, fmtEuro, romeToUtcMs } from "../assets/js/engine.js";
import { TEMPLATES, accessText } from "./templates.mjs";

const MAX_ATTEMPTS = 3;
const RETRY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PRE_ARRIVAL_DAYS = 2;
const SEND_AT = { preArrival: "10:00", checkInDay: "09:00", thanks: "11:30" }; // Rome time

// WhatsApp wants digits only, with country code. Italian mobiles written without prefix get +39.
export function normalizePhone(raw, countryCode = "39") {
  const text = String(raw ?? "").trim();
  let digits = text.replace(/\D/g, "");
  if (!text.startsWith("+")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (/^3\d{8,9}$/.test(digits)) digits = countryCode + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export const render = (text, vars) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));

// The text to paste into Meta's template manager: named placeholders become {{1}}, {{2}}…
export const metaText = (kind, lang) => {
  const t = TEMPLATES[kind];
  return t[lang].replace(/\{(\w+)\}/g, (_, key) => `{{${t.order.indexOf(key) + 1}}}`);
};

export const templateName = (kind) => `${PROPERTY.codePrefix.toLowerCase()}_${kind}`;
export const cloudConfigured = (env) => Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && env.WHATSAPP_API_VERSION);
export const whatsappMode = (env) => (cloudConfigured(env) ? "cloud" : "dry-run");

const DAY_FORMAT = { weekday: "long", day: "numeric", month: "long" };

function guestVars(rows, lang) {
  const [b] = rows;
  const locale = lang === "en" ? "en-GB" : "it-IT";
  return {
    name: b.guest.name.split(" ")[0],
    code: b.code,
    property: PROPERTY.name,
    rooms: rows.map((r) => roomById(r.roomId).name).join(" + "),
    checkIn: fmtDate(b.checkIn, DAY_FORMAT, locale),
    checkOut: fmtDate(b.checkOut, DAY_FORMAT, locale),
    window: `${PROPERTY.checkInFrom}–${PROPERTY.checkInTo}`,
    address: `${PROPERTY.address}, ${PROPERTY.city}`,
    maps: PROPERTY.mapsUrl,
    access: accessText(lang),
    review: PROPERTY.reviewsUrl,
    total: fmtEuro(rows.reduce((n, r) => n + r.total, 0)),
    phone: b.guest.phone,
  };
}

const makeJob = (b, kind, audience, to, lang, vars, sendAtMs, extra = {}) => ({
  id: randomUUID(), code: b.code, kind, audience, to, lang, template: templateName(kind), vars,
  text: render(TEMPLATES[kind][lang], vars), sendAt: new Date(sendAtMs).toISOString(), status: "scheduled", attempts: 0, ...extra,
});

// Every direct booking gets: confirmation now, instructions 2 days before, a check-in-day note, a thank-you
// after check-out, and an alert to the host. Guest messages only go out if the guest opted in to WhatsApp.
export function scheduleJobs(rows, { nowMs }) {
  const [b] = rows;
  const lang = b.guest.lang === "en" ? "en" : "it";
  const phone = normalizePhone(b.guest.phone);
  const jobs = [];
  if (b.guest.whatsapp && phone) {
    const vars = guestVars(rows, lang);
    const add = (kind, at) => jobs.push(makeJob(b, kind, "guest", phone, lang, vars, at));
    add("booking_confirmed", nowMs);
    const pre = romeToUtcMs(addDays(b.checkIn, -PRE_ARRIVAL_DAYS), SEND_AT.preArrival);
    const day = romeToUtcMs(b.checkIn, SEND_AT.checkInDay);
    if (pre > nowMs) add("pre_arrival", pre);
    if (day > nowMs) add("checkin_day", day);
    add("checkout_thanks", romeToUtcMs(b.checkOut, SEND_AT.thanks));
  }
  jobs.push(makeJob(b, "host_new_booking", "host", PROPERTY.whatsapp, "it", guestVars(rows, "it"), nowMs));
  return jobs;
}

// A channel reservation landed on dates that were already taken: tell the host straight away.
export function conflictJob(row, others, nowMs) {
  const vars = {
    rooms: roomById(row.roomId).name,
    checkIn: fmtDate(row.checkIn, DAY_FORMAT, "it-IT"),
    checkOut: fmtDate(row.checkOut, DAY_FORMAT, "it-IT"),
    channel: row.channel,
    other: others[0].channel,
  };
  return makeJob(row, "host_conflict", "host", PROPERTY.whatsapp, "it", vars, nowMs);
}

export const cancelGuestJobs = (outbox, code) =>
  outbox.map((j) => (j.code === code && j.audience === "guest" && j.status === "scheduled" ? { ...j, status: "cancelled" } : j));

export function cloudPayload(job) {
  return {
    messaging_product: "whatsapp", to: job.to, type: "template",
    template: {
      name: job.template, language: { code: job.lang },
      components: [{ type: "body", parameters: TEMPLATES[job.kind].order.map((key) => ({ type: "text", text: String(job.vars[key]) })) }],
    },
  };
}

// Demo mode never touches the network. Seeded demo jobs are never sent, even with real credentials.
export async function deliver(job, { env, fetchImpl }) {
  if (job.seeded) return { mode: "demo" };
  if (!cloudConfigured(env)) return { mode: "dry-run" };
  const res = await fetchImpl(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cloudPayload(job)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${body.error?.message ?? "request failed"}`);
  return { mode: "cloud", providerId: body.messages?.[0]?.id };
}

// Sends every job that is due. A failed send is retried a few times, then marked failed (never silently dropped).
export async function runDue({ db, nowMs, env, fetchImpl }) {
  const due = db.get().outbox.filter((j) => j.status === "scheduled" && Date.parse(j.sendAt) <= nowMs);
  for (const job of due) {
    let patch;
    try {
      const sent = await deliver(job, { env, fetchImpl });
      patch = { status: "sent", mode: sent.mode, providerId: sent.providerId, sentAt: new Date(nowMs).toISOString(), error: null };
    } catch (err) {
      const attempts = job.attempts + 1;
      patch = attempts >= MAX_ATTEMPTS
        ? { status: "failed", attempts, error: err.message }
        : { attempts, error: err.message, sendAt: new Date(nowMs + attempts * RETRY_MS).toISOString() };
    }
    await db.update((s) => ({ ...s, outbox: s.outbox.map((j) => (j.id === job.id ? { ...j, ...patch } : j)) }));
  }
  return due.length;
}
