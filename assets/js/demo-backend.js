// In-browser stand-in for the Node server, used when a page is hosted without one (a static host such as Netlify).
// It answers the same /api/*, /ical/* and /mock/* requests with the same booking core the server runs
// (api/core.js); the data lives in the visitor's browser (localStorage) and is re-seeded every day.
import { HttpError, createCore } from "./api/core.js";
import { seedState } from "./api/seed.js";
import { PROPERTY } from "./data.js";
import { todayISO } from "./engine.js";

const TICK_MS = 15_000; // same cadence as server/index.mjs: send due WhatsApp messages,
const SYNC_MS = 30_000; // read the channel calendars,
const PULL_MS = 180_000; // and let the mock Booking.com read ours
const JSON_TYPE = "application/json; charset=utf-8";
const FALLBACK_ORIGIN = "http://demo.local"; // a page opened from a file has no usable origin

// A db with the shape server/db.mjs has ({ get, update }), kept in a Storage. `day` is the real calendar day the data was
// seeded on: a new day starts from a fresh seed, so the demo calendar never ages out. watch(fn) calls fn when another
// tab changed the stored data.
function openStorageDb({ storage, key, initial, day, watch }) {
  const load = () => {
    try {
      const saved = JSON.parse(storage?.getItem(key) ?? "null");
      return saved?.day === day() && saved.state?.bookings ? saved.state : null;
    } catch {
      return null; // storage blocked or the value is not ours: start fresh
    }
  };
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify({ day: day(), state }));
    } catch { /* storage full or blocked: the demo keeps working in memory for this page */ }
  };
  let state = load() ?? initial();
  save();
  watch?.(() => { state = load() ?? state; });
  return {
    get: () => state,
    // fn(state) is synchronous and returns the next state, so check-and-write cannot interleave.
    async update(fn) {
      state = fn(state);
      save();
      return state;
    },
  };
}

const respond = (status, body, type = JSON_TYPE) => new Response(type === JSON_TYPE ? JSON.stringify(body) : body, { status, headers: { "content-type": type } });

function parseBody(body) {
  if (body === undefined || body === null || body === "") return {};
  let value;
  try {
    value = JSON.parse(String(body));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "JSON object expected");
  return value;
}

// Returns { fetch, stop }. fetch(path, init) behaves like window.fetch for the API paths and resolves once the first
// pull/sync has imported the Booking.com reservations (the server does the same before it takes traffic).
export function createDemoBackend({ storage, origin = FALLBACK_ORIGIN, now = Date.now, key = `${PROPERTY.codePrefix.toLowerCase()}.demo`, watch } = {}) {
  const realDay = () => todayISO(now());
  const db = openStorageDb({ storage, key, initial: () => seedState({ nowMs: now() }), day: realDay, watch });

  const dispatch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, `${origin}/`);
    const request = {
      method: (init.method ?? "GET").toUpperCase(), pathname: url.pathname, search: url.searchParams,
      json: async () => parseBody(init.body), authorize: () => {}, // no accounts in the demo: the console is open
    };
    try {
      const out = await core.handle(request);
      if (!out) throw new HttpError(404, "not found");
      return out.raw !== undefined ? respond(200, out.raw, out.type) : respond(out.status ?? 200, out.body);
    } catch (err) {
      if (err instanceof HttpError) return respond(err.status, err.body);
      console.error(`${request.method} ${url.pathname} failed:`, err);
      return respond(500, { error: "internal error" });
    }
  };
  // The core fetches the calendar feeds through the same routes (calendars of the mock Booking.com and ours).
  const core = createCore({ db, env: {}, fetchImpl: dispatch, now, getOrigin: () => origin });
  const ready = core.pull().then(() => core.sync()).catch((err) => console.error("demo backend start-up failed:", err.message));

  const log = (what) => (err) => console.error(`${what} failed:`, err.message);
  const timers = [
    setInterval(() => core.tick().catch(log("whatsapp tick")), TICK_MS),
    setInterval(() => core.sync().catch(log("channel sync")), SYNC_MS),
    setInterval(() => core.pull().catch(log("mock pull")), PULL_MS),
  ];
  return { fetch: async (input, init) => (await ready, dispatch(input, init)), stop: () => timers.forEach(clearInterval) };
}

export function startDemoBackend() {
  let storage = null;
  try {
    storage = localStorage;
  } catch { /* storage blocked: the demo runs in memory, one page at a time */ }
  const origin = location.protocol.startsWith("http") ? location.origin : FALLBACK_ORIGIN;
  const key = `${PROPERTY.codePrefix.toLowerCase()}.demo`;
  return createDemoBackend({ storage, origin, key, watch: (fn) => addEventListener("storage", (e) => e.key === key && fn()) });
}
