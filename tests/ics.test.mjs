import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeed, parseFeed } from "../server/ics.mjs";

const events = [
  { uid: "a@x", start: "2027-03-10", end: "2027-03-12", summary: "Reserved" },
  { uid: "b@x", start: "2027-04-01", end: "2027-04-02", summary: "Rossi, Mario; 2 guests" },
];

test("a feed we build can be read back unchanged", () => {
  assert.deepEqual(parseFeed(buildFeed({ name: "Test", events })), events);
});

test("the feed is a valid calendar envelope with all-day events and CRLF line ends", () => {
  const text = buildFeed({ name: "Fabrì 171", events: [events[0]] });
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(text, /DTSTART;VALUE=DATE:20270310\r\nDTEND;VALUE=DATE:20270312/);
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
});

test("an empty feed has no events", () => {
  assert.deepEqual(parseFeed(buildFeed({ name: "Empty", events: [] })), []);
});

test("parser handles folded lines, date-times, time-zone parameters and missing DTEND", () => {
  const text = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:one", "DTSTART;TZID=Europe/Rome:20270310T150000", "DTEND;TZID=Europe/Rome:20270312T100000",
    "SUMMARY:A very long", " summary that was folded", "END:VEVENT",
    "BEGIN:VEVENT", "UID:two", "DTSTART;VALUE=DATE:20270501", "END:VEVENT", "END:VCALENDAR",
  ].join("\n");
  assert.deepEqual(parseFeed(text), [
    { uid: "one", start: "2027-03-10", end: "2027-03-12", summary: "A very longsummary that was folded" },
    { uid: "two", start: "2027-05-01", end: "2027-05-02", summary: "" },
  ]);
});

test("parser skips cancelled, broken and backwards events", () => {
  const text = [
    "BEGIN:VEVENT", "UID:c", "DTSTART;VALUE=DATE:20270310", "DTEND;VALUE=DATE:20270312", "STATUS:CANCELLED", "END:VEVENT",
    "BEGIN:VEVENT", "UID:d", "DTSTART;VALUE=DATE:20270320", "DTEND;VALUE=DATE:20270318", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20270320", "DTEND;VALUE=DATE:20270322", "END:VEVENT",
    "BEGIN:VEVENT", "UID:f", "DTSTART;VALUE=DATE:garbage", "END:VEVENT",
  ].join("\r\n");
  assert.deepEqual(parseFeed(text), []);
});

test("parser tolerates text that is not a calendar", () => {
  assert.deepEqual(parseFeed("<html>Not found</html>"), []);
  assert.deepEqual(parseFeed(""), []);
});
