// Pure booking logic shared by the browser and the local server: no DOM, no storage.
// Statuses and channel names stay in Italian ("confermata", "annullata", "Sito web") because they are stored data.
import { ROOMS, roomById, PROPERTY } from "./data.js";

const DAY_MS = 86_400_000;
const TIMEZONE = "Europe/Rome";
const MAX_TEXT = 200;
const MAX_NOTES = 500;

export const MAX_NIGHTS = 30;
export const OTA_COMMISSION = 0.15; // typical Booking.com commission, an estimate (15–22%)
export const DIRECT_DISCOUNT = PROPERTY.directDiscount;
export const MAX_GUESTS = ROOMS.reduce((n, r) => n + r.guests, 0);
export const CHANNEL_DIRECT = "Sito web";
export const CHANNEL_PHONE = "Telefono";
export const CHANNEL_BOOKING = "Booking.com";

// ---------- dates: always "YYYY-MM-DD" in UTC so daylight saving never shifts a day
export const toISO = (d) => d.toISOString().slice(0, 10);
export const parseISO = (iso) => new Date(`${iso}T00:00:00Z`);
export const addDays = (iso, n) => toISO(new Date(parseISO(iso).getTime() + n * DAY_MS));
export const nightsBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY_MS);
export const eachNight = (checkIn, checkOut) =>
  Array.from({ length: Math.max(0, nightsBetween(checkIn, checkOut)) }, (_, i) => addDays(checkIn, i));
// "Today" as the property sees it (Rome), not the visitor's time zone.
export const todayISO = (nowMs = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(nowMs);

function offsetMs(utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(utcMs).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
// Wall-clock time in Rome ("2027-03-27", "10:00") → UTC milliseconds, correct across the DST switch.
export function romeToUtcMs(dateISO, hhmm) {
  const naive = Date.parse(`${dateISO}T${hhmm}:00Z`);
  return naive - offsetMs(naive - offsetMs(naive));
}

// ---------- availability (bookings are always passed in: the engine owns no state)
export const isActive = (b) => b.status !== "annullata";
export const isRoomFree = (roomId, checkIn, checkOut, bookings) =>
  !bookings.some((b) => isActive(b) && b.roomId === roomId && b.checkIn < checkOut && checkIn < b.checkOut);

export function bookedNights(roomId, bookings) {
  const nights = new Set();
  for (const b of bookings) if (isActive(b) && b.roomId === roomId) eachNight(b.checkIn, b.checkOut).forEach((n) => nights.add(n));
  return nights;
}

export const freeRooms = (checkIn, checkOut, bookings) => ROOMS.filter((r) => isRoomFree(r.id, checkIn, checkOut, bookings));

// ---------- guests and capacity: rooms have different sizes, so we count seats
export const peopleOf = ({ adults = 1, children = 0 } = {}) => adults + children;
export const seats = (roomIds) => roomIds.reduce((n, id) => n + (roomById(id)?.guests ?? 0), 0);
export function roomsNeeded(party) {
  const people = peopleOf(party);
  let seated = 0;
  let count = 0;
  for (const size of ROOMS.map((r) => r.guests).sort((a, b) => b - a)) {
    if (seated >= people) break;
    seated += size;
    count += 1;
  }
  return Math.max(1, count);
}

// ---------- prices
export function quote(room, checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);
  const total = nights * room.rate;
  const portal = Math.round(total / (1 - DIRECT_DISCOUNT));
  return { nights, rate: room.rate, total, portal, saving: portal - total };
}

export function quoteRooms(roomIds, checkIn, checkOut) {
  const lines = roomIds.map((id) => ({ room: roomById(id), ...quote(roomById(id), checkIn, checkOut) }));
  const sum = (k) => lines.reduce((n, l) => n + l[k], 0);
  return { lines, nights: nightsBetween(checkIn, checkOut), total: sum("total"), portal: sum("portal"), saving: sum("saving") };
}

// ---------- validation: errors are codes (not text), the page translates them
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s().\/-]{7,}$/;
const isCount = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

export function validateBooking(input, { bookings, today }) {
  const errors = {};
  const roomIds = Array.isArray(input.roomIds) ? input.roomIds : [];
  const party = { adults: input.adults, children: input.children ?? 0, infants: input.infants ?? 0 };
  const partyOk = isCount(party.adults, 1, MAX_GUESTS) && isCount(party.children, 0, MAX_GUESTS) && isCount(party.infants, 0, ROOMS.length);
  if (!partyOk || peopleOf(party) > MAX_GUESTS) errors.guests = "guests";
  if (!roomIds.length || new Set(roomIds).size !== roomIds.length || roomIds.some((id) => !roomById(id))) errors.rooms = "rooms";
  else if (!errors.guests && seats(roomIds) < peopleOf(party)) errors.rooms = "roomsTooFew";
  if (!input.checkIn || !input.checkOut) errors.dates = "dates";
  else if (input.checkIn < today) errors.dates = "datesPast";
  else {
    const nights = nightsBetween(input.checkIn, input.checkOut);
    if (!(nights >= 1)) errors.dates = "datesOrder";
    else if (nights > MAX_NIGHTS) errors.dates = "datesLong";
    else if (!errors.rooms && roomIds.some((id) => !isRoomFree(id, input.checkIn, input.checkOut, bookings))) errors.rooms = "roomTaken";
  }
  const g = input.guest ?? {};
  if (!String(g.firstName ?? "").trim()) errors.firstName = "firstName";
  if (!String(g.lastName ?? "").trim()) errors.lastName = "lastName";
  if (!EMAIL_RE.test(String(g.email ?? ""))) errors.email = "email";
  const phone = String(g.phone ?? "");
  if (!PHONE_RE.test(phone) || (phone.match(/\d/g) ?? []).length < 6) errors.phone = "phone";
  if (input.invoice && !String(input.invoice.vat ?? "").trim()) errors.vat = "vat";
  return errors;
}

const clean = (value, max = MAX_TEXT) => String(value ?? "").trim().slice(0, max);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// One booking code, one row per room, built only from whitelisted fields (never spread client input).
export function buildBookings(input, { code, createdAt, newId = () => globalThis.crypto.randomUUID() }) {
  const party = { adults: input.adults, children: input.children ?? 0, infants: input.infants ?? 0 };
  const guest = {
    name: `${clean(input.guest.firstName, 60)} ${clean(input.guest.lastName, 60)}`,
    email: clean(input.guest.email),
    phone: clean(input.guest.phone, 30),
    arrival: clean(input.guest.arrival, 30),
    notes: clean(input.guest.notes, MAX_NOTES),
    lang: input.guest.lang === "en" ? "en" : "it",
    whatsapp: input.guest.whatsapp === true,
  };
  const invoice = input.invoice ? { company: clean(input.invoice.company), vat: clean(input.invoice.vat, 40), sdi: clean(input.invoice.sdi, 40) } : null;
  return input.roomIds.map((roomId) => {
    const { nights, total } = quote(roomById(roomId), input.checkIn, input.checkOut);
    return {
      id: newId(), code, roomId, checkIn: input.checkIn, checkOut: input.checkOut, nights, total,
      adults: party.adults, party, rooms: input.roomIds.length,
      payment: input.payment === "bonifico" ? "bonifico" : "struttura", invoice,
      channel: CHANNEL_DIRECT, status: "confermata", createdAt, guest,
    };
  });
}

export const isIsoDate = (s) => ISO_RE.test(s ?? "") && !Number.isNaN(parseISO(s).getTime()) && toISO(parseISO(s)) === s;

// ---------- formatting
const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const fmtEuro = (n) => euro.format(n);
export const fmtDate = (iso, opts = { weekday: "short", day: "numeric", month: "short" }, locale = "it-IT") =>
  new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(parseISO(iso));

// Guest's own calendar entry. result = { code, bookings } from the API.
export function toICS({ code, bookings }) {
  const b = bookings[0];
  const names = bookings.map((x) => roomById(x.roomId).name).join(", ");
  const d = (iso) => iso.replaceAll("-", "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${PROPERTY.name} Pescara//Demo//IT`,
    "BEGIN:VEVENT", `UID:${code}@fabri171-demo`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d(b.checkIn)}`, `DTEND;VALUE=DATE:${d(b.checkOut)}`,
    `SUMMARY:${PROPERTY.name} — ${names}`,
    `LOCATION:${PROPERTY.address.replace(",", "\\,")}\\, ${PROPERTY.city}`,
    `DESCRIPTION:Codice ${code}. Check-in ${PROPERTY.checkInFrom}–${PROPERTY.checkInTo}.`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}
