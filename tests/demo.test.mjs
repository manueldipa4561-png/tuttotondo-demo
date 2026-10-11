// The in-browser backend (assets/js/demo-backend.js) answers the same API as the Node server, from a Storage.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { ROOMS } from "../assets/js/data.js";
import { addDays, isRoomFree } from "../assets/js/engine.js";
import { createDemoBackend } from "../assets/js/demo-backend.js";

const NOW = Date.parse("2026-10-11T10:00:00Z");
const TODAY = "2026-10-11";
const guest = { firstName: "Mario", lastName: "Rossi", email: "mario@example.com", phone: "+39 333 1234567", whatsapp: true, lang: "en" };

// the smallest Storage the backend needs
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
};

const backends = [];
const open = (storage, now = NOW) => {
  const backend = createDemoBackend({ storage, now: () => now, origin: "https://demo.test" });
  backends.push(backend);
  return backend;
};
after(() => backends.forEach((b) => b.stop())); // the three timers would keep the test process alive

const get = async (backend, path) => (await backend.fetch(path)).json();
const post = (backend, path, body) => backend.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function findFree(backend) {
  const { bookings } = await get(backend, "/api/availability");
  for (let d = 5; d < 140; d++) {
    for (const room of ROOMS) {
      const checkIn = addDays(TODAY, d);
      const checkOut = addDays(checkIn, 2);
      if (isRoomFree(room.id, checkIn, checkOut, bookings)) return { roomIds: [room.id], checkIn, checkOut, adults: 2, guest };
    }
  }
  throw new Error("no free window in the seeded calendar");
}

test("it starts with Booking.com reservations already imported into the calendar", async () => {
  const backend = open(memoryStorage());
  const data = await get(backend, "/api/availability");
  assert.equal(data.today, TODAY);
  assert.ok(data.bookings.length > 20);
});

test("a booking blocks its dates, queues the WhatsApp journey and shows in the feeds and the console", async () => {
  const backend = open(memoryStorage());
  const input = await findFree(backend);
  const res = await post(backend, "/api/bookings", input);
  assert.equal(res.status, 201);
  const { code } = await res.json();
  assert.match(code, /^TTD-[A-Z0-9]{4}$/);

  assert.equal((await post(backend, "/api/bookings", input)).status, 422, "the same dates cannot be sold twice");
  const { jobs, mode } = await get(backend, "/api/admin/outbox");
  assert.equal(mode, "dry-run");
  assert.ok(jobs.some((j) => j.code === code && j.kind === "host_new_booking"));
  assert.ok(jobs.filter((j) => j.code === code && j.audience === "guest").length >= 3);

  const feed = await (await backend.fetch(`/ical/${input.roomIds[0]}.ics?exclude=Booking.com`)).text();
  assert.match(feed, new RegExp(`DTSTART;VALUE=DATE:${input.checkIn.replaceAll("-", "")}`));
  const { channels } = await get(backend, "/api/admin/channels");
  assert.match(channels[0].exportUrls[input.roomIds[0]], /^https:\/\/demo\.test\/ical\//);

  assert.equal((await post(backend, `/api/admin/bookings/${code}/cancel`, {})).status, 200);
  const free = await get(backend, "/api/availability");
  assert.ok(isRoomFree(input.roomIds[0], input.checkIn, input.checkOut, free.bookings), "a cancelled booking frees its dates");
});

test("the mock Booking.com, the demo clock and the reset work", async () => {
  const backend = open(memoryStorage());
  const slot = await findFree(backend);
  const reserve = await post(backend, "/api/admin/mock/reserve", { roomId: slot.roomIds[0], start: slot.checkIn, end: slot.checkOut });
  assert.equal(reserve.status, 201);
  await post(backend, "/api/admin/sync", {});
  const { bookings } = await get(backend, "/api/admin/bookings");
  assert.ok(bookings.some((b) => b.roomId === slot.roomIds[0] && b.checkIn === slot.checkIn && b.channel === "Booking.com"));

  assert.equal((await post(backend, "/api/admin/demo/clock", { days: 3 })).status, 200);
  assert.equal((await get(backend, "/api/availability")).today, addDays(TODAY, 3));
  assert.equal((await post(backend, "/api/admin/demo/reset", {})).status, 200);
  assert.equal((await get(backend, "/api/availability")).today, TODAY);
});

test("answers like the server for bad input and unknown paths", async () => {
  const backend = open(memoryStorage());
  assert.equal((await backend.fetch("/api/nope")).status, 404);
  assert.equal((await post(backend, "/api/bookings", { checkIn: "nope" })).status, 422);
  const broken = await backend.fetch("/api/bookings", { method: "POST", body: "{not json" });
  assert.equal(broken.status, 400);
});

test("data survives a page load, and a new day starts from a fresh seed", async () => {
  const storage = memoryStorage();
  const first = open(storage);
  const input = await findFree(first);
  const { code } = await (await post(first, "/api/bookings", input)).json();

  const sameDay = open(storage);
  assert.ok((await get(sameDay, "/api/admin/bookings")).bookings.some((b) => b.code === code));

  const nextDay = open(storage, NOW + 86_400_000);
  assert.ok(!(await get(nextDay, "/api/admin/bookings")).bookings.some((b) => b.code === code), "yesterday's demo bookings are gone");
});

test("it keeps working in memory when storage is blocked", async () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  const backend = open(blocked);
  assert.ok((await get(backend, "/api/availability")).bookings.length > 20);
});
