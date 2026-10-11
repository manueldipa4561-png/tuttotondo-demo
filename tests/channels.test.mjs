import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roomById } from "../assets/js/data.js";
import { openDb } from "../server/db.mjs";
import { buildFeed, parseFeed } from "../assets/js/api/ics.js";
import { exportFeed, loadChannels, mockPull, mockReserve, reconcile, syncChannel } from "../assets/js/api/channels.js";

const channel = { id: "booking", name: "Booking.com", mock: true, feeds: {} };
const ctx = { today: "2027-03-01", createdAt: "2027-03-01T00:00:00.000Z" };
const ev = (uid, start, end) => ({ uid, start, end, summary: "CLOSED - Not available" });
const direct = { id: "d1", code: "TTD-AAAA", roomId: "bath", checkIn: "2027-03-10", checkOut: "2027-03-12", status: "confermata", channel: "Sito web", total: 100, guest: { name: "Mario Rossi" } };

test("our export hides guest names, cancelled stays and the channel's own reservations", () => {
  const bookings = [
    direct,
    { ...direct, id: "d2", checkIn: "2027-04-01", checkOut: "2027-04-03", status: "annullata" },
    { ...direct, id: "o1", checkIn: "2027-05-01", checkOut: "2027-05-03", channel: "Booking.com" },
    { ...direct, id: "d3", roomId: "triple", checkIn: "2027-06-01", checkOut: "2027-06-03" },
  ];
  const events = parseFeed(exportFeed(bookings, "bath", { exclude: "Booking.com" }));
  assert.deepEqual(events.map((e) => [e.start, e.end, e.summary]), [["2027-03-10", "2027-03-12", "Reserved"]]);
  assert.equal(parseFeed(exportFeed(bookings, "bath")).length, 2);
  assert.doesNotMatch(exportFeed(bookings, "bath"), /Rossi/);
});

test("importing a channel feed creates bookings; running it again changes nothing", () => {
  const events = [ev("u1", "2027-03-20", "2027-03-23")];
  const first = reconcile([], channel, "bath", events, ctx);
  assert.deepEqual(first.summary, { imported: 1, updated: 0, cancelled: 0, conflicts: 0 });
  const [row] = first.bookings;
  assert.match(row.code, /^OTA-/);
  assert.equal(row.channel, "Booking.com");
  assert.equal(row.nights, 3);
  assert.equal(row.total, 3 * roomById("bath").rate);
  assert.equal(row.estimated, true);
  const again = reconcile(first.bookings, channel, "bath", events, ctx);
  assert.deepEqual(again.summary, { imported: 0, updated: 0, cancelled: 0, conflicts: 0 });
  assert.deepEqual(again.bookings, first.bookings);
});

test("a changed reservation is updated, a vanished future one is cancelled, a past one just ages out", () => {
  const first = reconcile([direct], channel, "bath", [ev("u1", "2027-03-20", "2027-03-23"), ev("old", "2027-02-10", "2027-02-12")], ctx);
  const moved = reconcile(first.bookings, channel, "bath", [ev("u1", "2027-03-21", "2027-03-23"), ev("old", "2027-02-10", "2027-02-12")], ctx);
  assert.equal(moved.summary.updated, 1);
  assert.equal(moved.bookings.find((b) => b.sourceUid === "u1").checkIn, "2027-03-21");
  const gone = reconcile(moved.bookings, channel, "bath", [], ctx);
  assert.equal(gone.summary.cancelled, 1); // only the future one
  assert.equal(gone.bookings.find((b) => b.sourceUid === "u1").status, "annullata");
  assert.equal(gone.bookings.find((b) => b.sourceUid === "old").status, "confermata");
  assert.equal(gone.bookings.find((b) => b.id === "d1").status, "confermata"); // never touches our own bookings
  const back = reconcile(gone.bookings, channel, "bath", [ev("u1", "2027-03-21", "2027-03-23")], ctx);
  assert.equal(back.bookings.find((b) => b.sourceUid === "u1").status, "confermata");
});

test("a channel reservation on dates we already sold is flagged as a conflict", () => {
  const result = reconcile([direct], channel, "bath", [ev("clash", "2027-03-11", "2027-03-13")], ctx);
  assert.equal(result.summary.conflicts, 1);
  assert.equal(result.bookings.find((b) => b.sourceUid === "clash").conflict, true);
  assert.equal(result.conflicts[0].others[0].id, "d1");
});

const feedOf = (...events) => buildFeed({ name: "x", events });
const fakeFetch = (pages) => async (url) => (url in pages ? { ok: true, status: 200, text: async () => pages[url] } : { ok: false, status: 503, text: async () => "" });

async function freshDb(bookings = []) {
  const dir = await mkdtemp(join(tmpdir(), "ttd-ch-"));
  return openDb(join(dir, "db.json"), () => ({ bookings, outbox: [], channels: {}, mock: { reservations: [], seen: {}, lastPull: null }, clockOffsetMs: 0 }));
}

test("sync imports what it can, reports what failed, and alerts the host about a clash", async () => {
  const db = await freshDb([direct]);
  const nowMs = Date.parse("2027-03-01T10:00:00Z");
  const ch = { ...channel, feeds: { bath: "http://x/bath.ics", triple: "http://x/triple.ics" } };
  const pages = { "http://x/bath.ics": feedOf(ev("clash", "2027-03-11", "2027-03-13"), ev("fine", "2027-04-01", "2027-04-03")) };
  const result = await syncChannel({ db, fetchImpl: fakeFetch(pages), nowMs }, ch);
  assert.deepEqual([result.imported, result.conflicts], [2, 1]);
  assert.deepEqual(result.errors, ["triple: HTTP 503"]);
  const state = db.get();
  assert.equal(state.channels.booking.lastSync, new Date(nowMs).toISOString());
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].kind, "host_conflict");
  assert.match(state.outbox[0].text, /ATTENZIONE: doppia prenotazione in Double Bath/);
});

test("the mock Booking.com refuses dates it knows are taken and invents nothing else", () => {
  const state = { mock: { reservations: [], seen: { bath: [{ start: "2027-03-10", end: "2027-03-12" }] }, lastPull: null } };
  const code = (input) => { try { mockReserve(state, input, "2027-03-01"); return "ok"; } catch (err) { return err.code; } };
  assert.equal(code({ roomId: "bath", start: "2027-03-11", end: "2027-03-13" }), "unavailable");
  assert.equal(code({ roomId: "bath", start: "2027-03-12", end: "2027-03-14" }), "ok");
  assert.equal(code({ roomId: "triple", start: "2027-03-11", end: "2027-03-13" }), "ok");
  assert.equal(code({ roomId: "suite", start: "2027-03-11", end: "2027-03-13" }), "room");
  assert.equal(code({ roomId: "bath", start: "2027-02-20", end: "2027-02-22" }), "dates");
  assert.equal(code({ roomId: "bath", start: "2027-03-20", end: "2027-03-20" }), "dates");
  assert.equal(code({ roomId: "bath", start: "2027-03-20", end: "2027-05-20" }), "dates");
  assert.equal(code({ roomId: "bath", start: "garbage", end: "2027-03-22" }), "dates");
  const added = mockReserve(state, { roomId: "bath", start: "2027-03-12", end: "2027-03-14" }, "2027-03-01");
  assert.equal(added.mock.reservations.length, 1);
  assert.equal(state.mock.reservations.length, 0); // input state is not mutated
  assert.throws(() => mockReserve(added, { roomId: "bath", start: "2027-03-13", end: "2027-03-15" }, "2027-03-01"), { code: "unavailable" });
});

test("a mock pull records what Booking.com now sees of our calendar", async () => {
  const db = await freshDb([direct]);
  const url = (room) => `http://x/ical/${room}.ics?exclude=Booking.com`;
  const fetchImpl = fakeFetch({ [url("bath")]: exportFeed([direct], "bath", { exclude: "Booking.com" }), ...Object.fromEntries(["double", "large", "standard", "triple"].map((id) => [url(id), exportFeed([], id)])) });
  await mockPull({ db, fetchImpl, baseUrl: "http://x", nowMs: Date.parse("2027-03-01T10:00:00Z") });
  assert.deepEqual(db.get().mock.seen.bath, [{ start: "2027-03-10", end: "2027-03-12" }]);
  assert.deepEqual(db.get().mock.seen.triple, []);
  assert.equal(db.get().mock.lastPull, "2027-03-01T10:00:00.000Z");
});

test("channel configuration: mock by default, real feeds from the environment, bad input rejected", () => {
  const [mock] = loadChannels({ env: {}, baseUrl: "http://127.0.0.1:1" });
  assert.deepEqual([mock.id, mock.mock, mock.feeds.bath], ["booking", true, "http://127.0.0.1:1/mock/booking/bath.ics"]);
  const real = loadChannels({ env: { CHANNEL_FEEDS_JSON: JSON.stringify({ booking: { name: "Booking.com", feeds: { bath: "https://admin.booking.com/x.ics" } } }) }, baseUrl: "" });
  assert.deepEqual([real[0].mock, real[0].feeds.bath], [false, "https://admin.booking.com/x.ics"]);
  const bad = (json) => () => loadChannels({ env: { CHANNEL_FEEDS_JSON: json }, baseUrl: "" });
  assert.throws(bad("{nope"), /not valid JSON/);
  assert.throws(bad(JSON.stringify({ b: { name: "B", feeds: { suite: "https://x/y.ics" } } })), /unknown room/);
  assert.throws(bad(JSON.stringify({ b: { name: "B", feeds: { bath: "ftp://x/y.ics" } } })), /not an http/);
  assert.throws(bad(JSON.stringify({ b: { feeds: {} } })), /needs "name"/);
});
