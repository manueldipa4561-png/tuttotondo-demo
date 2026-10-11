import { uuid } from "./ids.js";
import { PROPERTY, ROOMS } from "../data.js";
import { CHANNEL_DIRECT, CHANNEL_PHONE, addDays, nightsBetween, romeToUtcMs, todayISO } from "../engine.js";
import { scheduleJobs } from "./whatsapp.js";

const BACK_DAYS = 10;
const AHEAD_DAYS = 150;
const BOOKING_SHARE = 0.7;
const PHONE_SHARE = 0.85; // between BOOKING_SHARE and this value: phone; above: direct from the site
const SEEDED_THREADS = 2; // direct bookings that already have a WhatsApp history in the outbox
const DEMO_GUESTS = ["Giulia R.", "Marco T.", "Lena S.", "Paolo B.", "Chiara M.", "Tom H.", "Sofia L.", "Andrea F.", "Marta G.", "Luca P.", "Ana C.", "Yuki T."];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic demo data. The Booking.com reservations live in the MOCK channel and reach our calendar through
// the normal iCal sync; phone and website bookings are stored directly. Seeded guests use obviously fake numbers
// and their jobs are flagged `seeded`, so a real WhatsApp token can never message them.
export function seedState({ nowMs }) {
  const today = todayISO(nowMs);
  const rand = mulberry32(129);
  const reservations = [];
  const own = [];
  for (const room of ROOMS) {
    let cursor = addDays(today, -BACK_DAYS);
    const end = addDays(today, AHEAD_DAYS);
    while (cursor < end) {
      const gap = rand() < 0.22 ? 6 + Math.floor(rand() * 12) : 1 + Math.floor(rand() * 4);
      const start = addDays(cursor, gap);
      const stop = addDays(start, 1 + Math.floor(rand() * 4));
      const roll = rand();
      if (roll < BOOKING_SHARE) reservations.push({ uid: `seed-${room.id}-${start}@booking.demo`, roomId: room.id, start, end: stop });
      else own.push({ roomId: room.id, start, end: stop, channel: roll < PHONE_SHARE ? CHANNEL_PHONE : CHANNEL_DIRECT });
      cursor = stop;
    }
  }
  const room = (id) => ROOMS.find((r) => r.id === id);
  const bookings = own.map((s, i) => {
    const nights = nightsBetween(s.start, s.end);
    const withThread = s.channel === CHANNEL_DIRECT && s.start > today;
    return {
      id: uuid(), code: `${PROPERTY.codePrefix}-S${String(i + 1).padStart(3, "0")}`, roomId: s.roomId,
      checkIn: s.start, checkOut: s.end, nights, total: nights * room(s.roomId).rate, adults: 2,
      party: { adults: 2, children: 0, infants: 0 }, rooms: 1, payment: "struttura", invoice: null, channel: s.channel,
      status: "confermata", createdAt: new Date(romeToUtcMs(addDays(today, -3), "15:20")).toISOString(), seeded: true,
      guest: { name: DEMO_GUESTS[i % DEMO_GUESTS.length], email: "", phone: withThread ? "+39 333 000 0000" : "", arrival: "", notes: "", lang: i % 3 === 0 ? "en" : "it", whatsapp: withThread },
    };
  });
  const threads = bookings.filter((b) => b.guest.whatsapp).slice(0, SEEDED_THREADS);
  const createdMs = romeToUtcMs(addDays(today, -3), "15:20");
  const outbox = threads.flatMap((b) =>
    scheduleJobs([b], { nowMs: createdMs }).map((j) => {
      const past = Date.parse(j.sendAt) <= nowMs;
      return { ...j, to: "demo", seeded: true, status: past ? "sent" : "scheduled", mode: past ? "demo" : undefined, sentAt: past ? j.sendAt : undefined };
    }),
  );
  return {
    bookings: bookings.map((b) => (threads.includes(b) ? b : { ...b, guest: { ...b.guest, whatsapp: false, phone: "" } })),
    outbox, channels: {}, mock: { reservations, seen: {}, lastPull: null }, clockOffsetMs: 0,
  };
}
