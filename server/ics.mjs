import { addDays } from "../assets/js/engine.js";

const CRLF = "\r\n";
const escapeText = (s) => String(s).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, "\\n");
const unescapeText = (s) => s.replace(/\\n/gi, "\n").replace(/\\([\\;,])/g, "$1");
const compact = (iso) => iso.replaceAll("-", "");
const stampOf = (date) => date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

// events: [{ uid, start: "YYYY-MM-DD", end: "YYYY-MM-DD" (checkout day), summary }]
export function buildFeed({ name, events, stamp = new Date() }) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tuttotondo demo//direct booking//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeText(name)}`];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stampOf(stamp)}`,
      `DTSTART;VALUE=DATE:${compact(e.start)}`, `DTEND;VALUE=DATE:${compact(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`, "TRANSP:OPAQUE", "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}

// ponytail: date-time events are reduced to their calendar date (no time-zone maths) and RRULE recurrence is
// ignored. Booking.com, Airbnb and PMS exports are all-day; add a real iCal parser if a channel needs more.
function toDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseFeed(text) {
  const events = [];
  let current = null;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current?.uid && current.start) {
        const end = current.end ?? addDays(current.start, 1); // an all-day event without DTEND lasts one day
        if (end > current.start && current.status !== "CANCELLED") events.push({ uid: current.uid, start: current.start, end, summary: current.summary ?? "" });
      }
      current = null;
    } else if (current) {
      const sep = line.indexOf(":");
      if (sep < 0) continue;
      const prop = line.slice(0, sep).split(";")[0].toUpperCase();
      const value = line.slice(sep + 1);
      if (prop === "UID") current.uid = value.trim();
      else if (prop === "DTSTART") current.start = toDate(value);
      else if (prop === "DTEND") current.end = toDate(value);
      else if (prop === "SUMMARY") current.summary = unescapeText(value);
      else if (prop === "STATUS") current.status = value.trim().toUpperCase();
    }
  }
  return events;
}
