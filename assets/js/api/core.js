// The booking API itself, with no HTTP and no Node in it: routes, validation, WhatsApp scheduling and channel sync.
// Two adapters run it: server/app.mjs (a Node http server, the real thing) and ../demo-backend.js (the same routes
// answered inside the browser when a page is hosted without a server, e.g. on a static host).
import { PROPERTY, ROOMS, roomById } from "../data.js";
import { buildBookings, isActive, todayISO, validateBooking } from "../engine.js";
import { exportFeed, loadChannels, mockFeedText, mockPull, mockReserve, syncChannel } from "./channels.js";
import { randomIndex } from "./ids.js";
import { seedState } from "./seed.js";
import { cancelGuestJobs, runDue, scheduleJobs, whatsappMode } from "./whatsapp.js";

const MAX_ADVANCE_DAYS = 60;
const DAY_MS = 86_400_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === "string" ? body : body.error);
    this.status = status;
    this.body = typeof body === "string" ? { error: body } : body;
  }
}

const uniqueCode = (bookings) => {
  for (;;) {
    const suffix = Array.from({ length: 4 }, () => CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)]).join("");
    const code = `${PROPERTY.codePrefix}-${suffix}`;
    if (!bookings.some((b) => b.code === code)) return code;
  }
};

// db: { get(), update(fn) } as in server/db.mjs. getOrigin(): the address channels use to reach our calendar feeds.
// handle(request) takes { method, pathname, search: URLSearchParams, json(): Promise<object>, authorize(): void }
// and returns { status?, body } or { raw, type }, or null when no route matches (the Node adapter then serves files).
export function createCore({ db, env, fetchImpl, now, getOrigin }) {
  const mockEnabled = !env.CHANNEL_FEEDS_JSON;
  const nowMs = () => now() + db.get().clockOffsetMs;
  const channels = () => loadChannels({ env, baseUrl: getOrigin() });

  // Background jobs run one at a time so they never interleave their reads and writes.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch((err) => console.error("background job failed:", err.message));
    return run;
  };
  const tick = () => serial(() => runDue({ db, nowMs: nowMs(), env, fetchImpl }));
  const pull = () => serial(async () => (mockEnabled ? mockPull({ db, fetchImpl, baseUrl: getOrigin(), nowMs: nowMs() }) : undefined));
  const syncOnly = () => serial(async () => {
    const results = {};
    for (const c of channels()) results[c.id] = await syncChannel({ db, fetchImpl, nowMs: nowMs() }, c);
    return results;
  });
  const sync = async () => {
    const results = await syncOnly();
    await tick(); // conflict alerts queued by the sync go out straight away
    return results;
  };

  // ---------- handlers: return { status, body } for JSON or { raw, type } for other content
  const availability = () => ({
    today: todayISO(nowMs()),
    // public: no names, no contact details, only what the calendar needs
    bookings: db.get().bookings.filter(isActive).map(({ roomId, checkIn, checkOut, status }) => ({ roomId, checkIn, checkOut, status })),
  });

  async function createBooking(req) {
    const input = await req.json();
    let created = [];
    await db.update((state) => {
      const at = nowMs();
      const errors = validateBooking(input, { bookings: state.bookings, today: todayISO(at) });
      if (Object.keys(errors).length) throw new HttpError(422, { error: "invalid", fields: errors });
      const code = uniqueCode(state.bookings);
      created = buildBookings(input, { code, createdAt: new Date(at).toISOString() });
      return { ...state, bookings: [...state.bookings, ...created], outbox: [...state.outbox, ...scheduleJobs(created, { nowMs: at })] };
    });
    tick().catch((err) => console.error("whatsapp tick failed:", err.message)); // the guest does not wait for WhatsApp
    return { status: 201, body: { code: created[0].code, bookings: created, total: created.reduce((n, b) => n + b.total, 0) } };
  }

  async function cancelBooking(req, [code]) {
    let cancelled = 0;
    await db.update((state) => {
      const rows = state.bookings.filter((b) => b.code === code);
      if (!rows.length) throw new HttpError(404, "booking not found");
      if (rows.some((b) => b.sourceUid)) throw new HttpError(409, "channel bookings are cancelled on the channel");
      cancelled = rows.length;
      return { ...state, bookings: state.bookings.map((b) => (b.code === code ? { ...b, status: "annullata" } : b)), outbox: cancelGuestJobs(state.outbox, code) };
    });
    return { body: { cancelled } };
  }

  function channelStatus() {
    const state = db.get();
    const token = env.ICAL_TOKEN ? `&token=${encodeURIComponent(env.ICAL_TOKEN)}` : "";
    return {
      body: {
        today: todayISO(nowMs()), clockOffsetDays: state.clockOffsetMs / DAY_MS, whatsapp: { mode: whatsappMode(env) },
        channels: channels().map((c) => ({
          id: c.id, name: c.name, mock: c.mock, ...state.channels[c.id],
          exportUrls: Object.fromEntries(ROOMS.map((r) => [r.id, `${getOrigin()}/ical/${r.id}.ics?exclude=${encodeURIComponent(c.name)}${token}`])),
        })),
        mock: mockEnabled ? { lastPull: state.mock.lastPull, reservations: state.mock.reservations.length, seen: Object.fromEntries(ROOMS.map((r) => [r.id, (state.mock.seen[r.id] ?? []).length])) } : null,
      },
    };
  }

  async function setClock(req) {
    const { days, reset } = await req.json();
    if (reset !== true && !(Number.isInteger(days) && days >= 1 && days <= MAX_ADVANCE_DAYS)) throw new HttpError(400, `days must be 1–${MAX_ADVANCE_DAYS}`);
    await db.update((s) => ({ ...s, clockOffsetMs: reset === true ? 0 : s.clockOffsetMs + days * DAY_MS }));
    await tick();
    await sync();
    return { body: { today: todayISO(nowMs()) } };
  }

  async function resetDemo() {
    await db.update(() => seedState({ nowMs: now() }));
    await pull();
    await sync();
    return { body: { ok: true } };
  }

  async function mockReserveRoute(req) {
    if (!mockEnabled) throw new HttpError(404, "mock channel disabled");
    const input = await req.json();
    await db.update((state) => {
      try {
        return mockReserve(state, input, todayISO(nowMs()));
      } catch (err) {
        if (err.code) throw new HttpError(409, { error: err.code });
        throw err;
      }
    });
    return { status: 201, body: { ok: true } };
  }

  const icalFeed = (search, roomId) => {
    if (env.ICAL_TOKEN && search.get("token") !== env.ICAL_TOKEN) throw new HttpError(403, "invalid feed token");
    if (!roomById(roomId)) throw new HttpError(404, "unknown room");
    return { raw: exportFeed(db.get().bookings, roomId, { exclude: search.get("exclude") ?? undefined }), type: "text/calendar; charset=utf-8" };
  };

  // [method, path pattern, needs admin, handler]
  const routes = [
    ["GET", /^\/api\/availability$/, false, () => ({ body: availability() })],
    ["POST", /^\/api\/bookings$/, false, createBooking],
    ["GET", /^\/ical\/([a-z0-9-]+)\.ics$/, false, (req, [room]) => icalFeed(req.search, room)],
    ["GET", /^\/mock\/booking\/([a-z0-9-]+)\.ics$/, false, (req, [room]) => {
      if (!mockEnabled || !roomById(room)) throw new HttpError(404, "not found");
      return { raw: mockFeedText(db.get(), room), type: "text/calendar; charset=utf-8" };
    }],
    ["GET", /^\/api\/admin\/bookings$/, true, () => ({ body: { today: todayISO(nowMs()), bookings: db.get().bookings } })],
    ["POST", /^\/api\/admin\/bookings\/([A-Za-z0-9-]{4,20})\/cancel$/, true, cancelBooking],
    ["GET", /^\/api\/admin\/channels$/, true, channelStatus],
    ["POST", /^\/api\/admin\/sync$/, true, async () => ({ body: await sync() })],
    ["GET", /^\/api\/admin\/outbox$/, true, () => ({ body: { mode: whatsappMode(env), jobs: db.get().outbox } })],
    ["POST", /^\/api\/admin\/demo\/clock$/, true, setClock],
    ["POST", /^\/api\/admin\/demo\/reset$/, true, resetDemo],
    ["POST", /^\/api\/admin\/mock\/reserve$/, true, mockReserveRoute],
    ["POST", /^\/api\/admin\/mock\/pull$/, true, async () => {
      if (!mockEnabled) throw new HttpError(404, "mock channel disabled");
      await pull();
      return { body: { ok: true } };
    }],
  ];

  async function handle(req) {
    for (const [method, pattern, admin, handler] of routes) {
      const match = method === req.method ? pattern.exec(req.pathname) : null;
      if (!match) continue;
      if (admin) req.authorize();
      return handler(req, match.slice(1));
    }
    return null;
  }

  return { tick, sync, pull, handle };
}
