import { createHash, randomUUID } from "node:crypto";
import { PROPERTY, ROOMS, roomById } from "../assets/js/data.js";
import { CHANNEL_BOOKING, MAX_NIGHTS, isActive, isIsoDate, nightsBetween, todayISO } from "../assets/js/engine.js";
import { buildFeed, parseFeed } from "./ics.mjs";
import { conflictJob } from "./whatsapp.mjs";

const FETCH_TIMEOUT_MS = 8000;
const otaId = (channelId, uid) => `ota-${createHash("sha1").update(`${channelId}:${uid}`).digest("hex").slice(0, 16)}`;

// ---------- configuration: real iCal links from the environment, or the built-in mock Booking.com
export function loadChannels({ env, baseUrl }) {
  if (!env.CHANNEL_FEEDS_JSON) {
    return [{ id: "booking", name: CHANNEL_BOOKING, mock: true, feeds: Object.fromEntries(ROOMS.map((r) => [r.id, `${baseUrl}/mock/booking/${r.id}.ics`])) }];
  }
  let parsed;
  try {
    parsed = JSON.parse(env.CHANNEL_FEEDS_JSON);
  } catch (err) {
    throw new Error(`CHANNEL_FEEDS_JSON is not valid JSON: ${err.message}`);
  }
  return Object.entries(parsed).map(([id, c]) => {
    if (!c?.name || typeof c.feeds !== "object") throw new Error(`CHANNEL_FEEDS_JSON.${id} needs "name" and "feeds"`);
    for (const [roomId, url] of Object.entries(c.feeds)) {
      if (!roomById(roomId)) throw new Error(`CHANNEL_FEEDS_JSON.${id}: unknown room "${roomId}"`);
      if (!/^https?:$/.test(new URL(url).protocol)) throw new Error(`CHANNEL_FEEDS_JSON.${id}.${roomId}: not an http(s) URL`);
    }
    return { id, name: c.name, mock: false, feeds: c.feeds };
  });
}

// ---------- export: what the channels read from us (our bookings, minus the ones that came from that channel)
export const exportFeed = (bookings, roomId, { exclude } = {}) =>
  buildFeed({
    name: `${PROPERTY.name} · ${roomById(roomId).name}`,
    events: bookings
      .filter((b) => isActive(b) && b.roomId === roomId && b.channel !== exclude)
      .map((b) => ({ uid: `${b.id}@${PROPERTY.codePrefix.toLowerCase()}-demo`, start: b.checkIn, end: b.checkOut, summary: "Reserved" })),
  });

// ---------- import: pure merge of one room's channel events into our bookings
export function reconcile(bookings, channel, roomId, events, { today, createdAt }) {
  const room = roomById(roomId);
  const seen = new Set(events.map((e) => otaId(channel.id, e.uid)));
  let next = bookings;
  let imported = 0;
  let updated = 0;
  const conflicts = [];
  for (const ev of events) {
    const id = otaId(channel.id, ev.uid);
    const existing = next.find((b) => b.id === id);
    if (existing && isActive(existing) && existing.checkIn === ev.start && existing.checkOut === ev.end) continue;
    const others = next.filter((b) => b.id !== id && isActive(b) && b.roomId === roomId && b.checkIn < ev.end && ev.start < b.checkOut);
    const nights = nightsBetween(ev.start, ev.end);
    const row = {
      id, code: `OTA-${id.slice(-5).toUpperCase()}`, roomId, checkIn: ev.start, checkOut: ev.end, nights,
      total: nights * room.rate, estimated: true, adults: 0, channel: channel.name, status: "confermata",
      createdAt: existing?.createdAt ?? createdAt, sourceUid: ev.uid, guest: { name: `Ospite ${channel.name}` },
      ...(others.length ? { conflict: true } : {}),
    };
    next = existing ? next.map((b) => (b.id === id ? row : b)) : [...next, row];
    if (existing) updated += 1;
    else imported += 1;
    if (others.length) conflicts.push({ row, others });
  }
  // Future reservations that vanished from the feed were cancelled on the channel. Past ones just aged out.
  const gone = next.filter((b) => b.channel === channel.name && b.roomId === roomId && b.sourceUid && isActive(b) && b.checkOut > today && !seen.has(b.id));
  next = next.map((b) => (gone.includes(b) ? { ...b, status: "annullata" } : b));
  return { bookings: next, conflicts, summary: { imported, updated, cancelled: gone.length, conflicts: conflicts.length } };
}

const add = (a, b) => ({ imported: a.imported + b.imported, updated: a.updated + b.updated, cancelled: a.cancelled + b.cancelled, conflicts: a.conflicts + b.conflicts });
const NO_CHANGES = { imported: 0, updated: 0, cancelled: 0, conflicts: 0 };

export async function syncChannel({ db, fetchImpl, nowMs }, channel) {
  const settled = await Promise.allSettled(Object.entries(channel.feeds).map(async ([roomId, url]) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "text/calendar" } });
    if (!res.ok) throw new Error(`${roomId}: HTTP ${res.status}`);
    return { roomId, events: parseFeed(await res.text()) };
  }));
  const feeds = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const errors = settled.filter((s) => s.status === "rejected").map((s) => String(s.reason?.message ?? s.reason));
  const today = todayISO(nowMs);
  const stamp = new Date(nowMs).toISOString();
  let totals = NO_CHANGES;
  await db.update((state) => {
    let bookings = state.bookings;
    let outbox = state.outbox;
    totals = NO_CHANGES;
    for (const { roomId, events } of feeds) {
      const result = reconcile(bookings, channel, roomId, events, { today, createdAt: stamp });
      bookings = result.bookings;
      totals = add(totals, result.summary);
      outbox = [...outbox, ...result.conflicts.map(({ row, others }) => conflictJob(row, others, nowMs))];
    }
    const status = { name: channel.name, mock: channel.mock, lastSync: stamp, lastResult: totals, errors };
    return { ...state, bookings, outbox, channels: { ...state.channels, [channel.id]: status } };
  });
  return { ...totals, errors };
}

// ---------- mock Booking.com: its own reservations, plus a periodic "pull" of our calendar (like the real thing,
// which reads our feed every few hours). The gap between pulls is exactly where a double booking can slip in.
export const mockFeedText = (state, roomId) =>
  buildFeed({
    name: `Booking.com · ${roomId}`,
    events: state.mock.reservations.filter((r) => r.roomId === roomId).map((r) => ({ uid: r.uid, start: r.start, end: r.end, summary: "CLOSED - Not available" })),
  });

export function mockReserve(state, { roomId, start, end }, today) {
  const fail = (code) => Object.assign(new Error(code), { code });
  if (!roomById(roomId)) throw fail("room");
  if (!isIsoDate(start) || !isIsoDate(end) || start < today) throw fail("dates");
  const nights = nightsBetween(start, end);
  if (!(nights >= 1 && nights <= MAX_NIGHTS)) throw fail("dates");
  const clash = (list) => list.some((x) => x.start < end && start < x.end);
  const own = state.mock.reservations.filter((r) => r.roomId === roomId);
  if (clash(own) || clash(state.mock.seen[roomId] ?? [])) throw fail("unavailable");
  const reservation = { uid: `${randomUUID()}@booking.demo`, roomId, start, end };
  return { ...state, mock: { ...state.mock, reservations: [...state.mock.reservations, reservation] } };
}

export async function mockPull({ db, fetchImpl, baseUrl, nowMs }) {
  const previous = db.get().mock.seen;
  const seen = {};
  await Promise.all(ROOMS.map(async (r) => {
    const url = `${baseUrl}/ical/${r.id}.ics?exclude=${encodeURIComponent(CHANNEL_BOOKING)}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    seen[r.id] = res.ok ? parseFeed(await res.text()).map(({ start, end }) => ({ start, end })) : (previous[r.id] ?? []);
  }));
  await db.update((s) => ({ ...s, mock: { ...s.mock, seen, lastPull: new Date(nowMs).toISOString() } }));
}
