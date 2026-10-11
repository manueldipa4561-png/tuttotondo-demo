// node --test   (from the repo root)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOMS, roomById } from "../assets/js/data.js";
import {
  MAX_GUESTS, addDays, bookedNights, buildBookings, freeRooms, isRoomFree, nightsBetween, quote, quoteRooms,
  romeToUtcMs, roomsNeeded, seats, todayISO, validateBooking,
} from "../assets/js/engine.js";

const guest = { firstName: "Mario", lastName: "Rossi", email: "mario@example.com", phone: "+39 333 1234567" };
const base = { roomIds: ["bath"], checkIn: "2027-03-10", checkOut: "2027-03-12", adults: 2, guest };
const existing = [{ roomId: "bath", checkIn: "2027-03-10", checkOut: "2027-03-12", status: "confermata" }];
const check = (input, bookings = []) => validateBooking(input, { bookings, today: "2027-01-01" });

test("date arithmetic survives the daylight-saving switch", () => {
  assert.equal(addDays("2027-03-27", 2), "2027-03-29");
  assert.equal(nightsBetween("2027-03-27", "2027-03-29"), 2);
  assert.equal(nightsBetween("2027-10-30", "2027-11-01"), 2);
});

test("Rome wall-clock time converts to UTC on both sides of the DST switch", () => {
  const at = (date, time) => new Date(romeToUtcMs(date, time)).toISOString();
  assert.equal(at("2026-10-24", "10:00"), "2026-10-24T08:00:00.000Z"); // CEST, UTC+2
  assert.equal(at("2026-10-26", "10:00"), "2026-10-26T09:00:00.000Z"); // CET, UTC+1
  assert.equal(at("2027-03-27", "10:00"), "2027-03-27T09:00:00.000Z");
  assert.equal(at("2027-03-29", "10:00"), "2027-03-29T08:00:00.000Z");
});

test("today is the property's day (Rome), not UTC's", () => {
  assert.equal(todayISO(Date.parse("2027-01-01T23:30:00Z")), "2027-01-02");
});

test("check-out day can be the next guest's check-in", () => {
  assert.equal(isRoomFree("bath", "2027-03-12", "2027-03-14", existing), true);
  assert.equal(isRoomFree("bath", "2027-03-08", "2027-03-10", existing), true);
  assert.equal(isRoomFree("bath", "2027-03-11", "2027-03-13", existing), false);
  assert.equal(isRoomFree("bath", "2027-03-01", "2027-03-20", existing), false);
  assert.equal(isRoomFree("triple", "2027-03-11", "2027-03-13", existing), true);
});

test("cancelled bookings free the room and its nights", () => {
  const cancelled = [{ ...existing[0], status: "annullata" }];
  assert.equal(isRoomFree("bath", "2027-03-11", "2027-03-13", cancelled), true);
  assert.equal(bookedNights("bath", cancelled).size, 0);
  assert.deepEqual(freeRooms("2027-03-10", "2027-03-12", existing).map((r) => r.id), ["double", "large", "standard", "triple"]);
});

test("rooms have different sizes, so capacity is counted in seats", () => {
  assert.equal(MAX_GUESTS, 11); // four doubles and one triple
  assert.equal(seats(["bath", "triple"]), 5);
  assert.equal(roomsNeeded({ adults: 1 }), 1);
  assert.equal(roomsNeeded({ adults: 3 }), 1); // the triple
  assert.equal(roomsNeeded({ adults: 4 }), 2);
  assert.equal(roomsNeeded({ adults: 3, children: 2 }), 2);
  assert.equal(roomsNeeded({ adults: 9 }), 4);
  assert.equal(roomsNeeded({ adults: MAX_GUESTS }), ROOMS.length);
});

test("quote: direct price against the portal price", () => {
  const q = quote(roomById("bath"), "2027-03-01", "2027-03-04");
  assert.equal(q.nights, 3);
  assert.equal(q.total, 3 * roomById("bath").rate);
  assert.ok(q.portal > q.total && q.saving === q.portal - q.total);
  const both = quoteRooms(["bath", "triple"], "2027-03-01", "2027-03-02");
  assert.equal(both.total, roomById("bath").rate + roomById("triple").rate);
});

test("validation: a good request has no errors", () => {
  assert.deepEqual(check(base), {});
});

test("validation: dates", () => {
  assert.equal(check({ ...base, checkIn: "2026-12-30", checkOut: "2027-01-02" }).dates, "datesPast");
  assert.equal(check({ ...base, checkOut: "2027-03-10" }).dates, "datesOrder");
  assert.equal(check({ ...base, checkOut: "2027-04-20" }).dates, "datesLong");
  assert.equal(check({ ...base, checkIn: undefined }).dates, "dates");
});

test("validation: rooms, capacity and clashes", () => {
  assert.equal(check({ ...base, adults: 3 }).rooms, "roomsTooFew");
  assert.equal(check({ ...base, roomIds: [] }).rooms, "rooms");
  assert.equal(check({ ...base, roomIds: ["bath", "bath"] }).rooms, "rooms");
  assert.equal(check({ ...base, roomIds: ["suite"] }).rooms, "rooms");
  assert.equal(check(base, existing).rooms, "roomTaken");
  assert.equal(check({ ...base, adults: 0 }).guests, "guests");
  assert.equal(check({ ...base, adults: MAX_GUESTS, children: 1 }).guests, "guests");
});

test("validation: guest details", () => {
  const bad = check({ ...base, guest: { firstName: " ", lastName: "", email: "nope", phone: "12" } });
  assert.deepEqual(Object.keys(bad).sort(), ["email", "firstName", "lastName", "phone"]);
  assert.equal(check({ ...base, invoice: { vat: " " } }).vat, "vat");
  assert.deepEqual(check({ ...base, invoice: { vat: "IT01234567890" } }), {});
});

test("buildBookings keeps only whitelisted fields and clamps free text", () => {
  const input = {
    ...base, roomIds: ["bath", "triple"], adults: 4, status: "annullata", channel: "Booking.com", total: 1, id: "forged",
    guest: { ...guest, notes: "x".repeat(900), lang: "de", whatsapp: "yes", isAdmin: true },
  };
  const rows = buildBookings(input, { code: "TTD-TEST", createdAt: "2027-01-01T00:00:00.000Z", newId: (() => { let n = 0; return () => `id-${++n}`; })() });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ["id-1", "id-2"]);
  for (const r of rows) {
    assert.equal(r.code, "TTD-TEST");
    assert.equal(r.status, "confermata");
    assert.equal(r.channel, "Sito web");
    assert.equal(r.guest.notes.length, 500);
    assert.equal(r.guest.lang, "it");
    assert.equal(r.guest.whatsapp, false);
    assert.equal("isAdmin" in r.guest, false);
  }
  assert.equal(rows[0].total, 2 * roomById("bath").rate);
  assert.equal(ROOMS.length, 5);
});

test("buildBookings accepts an explicit WhatsApp opt-in and English", () => {
  const [row] = buildBookings({ ...base, guest: { ...guest, lang: "en", whatsapp: true } }, { code: "TTD-OPT", createdAt: "x" });
  assert.equal(row.guest.lang, "en");
  assert.equal(row.guest.whatsapp, true);
});
