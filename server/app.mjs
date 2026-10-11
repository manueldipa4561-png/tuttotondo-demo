import { createServer } from "node:http";
import { randomInt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { PROPERTY, ROOMS, roomById } from "../assets/js/data.js";
import { buildBookings, isActive, todayISO, validateBooking } from "../assets/js/engine.js";
import { openDb } from "./db.mjs";
import { exportFeed, loadChannels, mockFeedText, mockPull, mockReserve, syncChannel } from "./channels.mjs";
import { seedState } from "./seed.mjs";
import { cancelGuestJobs, runDue, scheduleJobs, whatsappMode } from "./whatsapp.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ADVANCE_DAYS = 60;
const DAY_MS = 86_400_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PAGES = new Set(["/index.html", "/prenota.html", "/gestione.html"]);
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === "string" ? body : body.error);
    this.status = status;
    this.body = typeof body === "string" ? { error: body } : body;
  }
}

const SECURITY_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readJson(req) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "content-type must be application/json");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  if (!size) return {};
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "JSON object expected");
  return value;
}

const uniqueCode = (bookings) => {
  for (;;) {
    const suffix = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const code = `${PROPERTY.codePrefix}-${suffix}`;
    if (!bookings.some((b) => b.code === code)) return code;
  }
};

export async function createApp({ rootDir, dataDir, env = process.env, fetchImpl = fetch, now = Date.now }) {
  const remote = env.ALLOW_REMOTE === "1";
  if (remote && !env.ADMIN_TOKEN) throw new Error("ALLOW_REMOTE=1 requires ADMIN_TOKEN: the host console must never be open to the internet.");
  const db = await openDb(join(dataDir, "db.json"), () => seedState({ nowMs: now() }));
  const mockEnabled = !env.CHANNEL_FEEDS_JSON;
  let origin = "";
  const nowMs = () => now() + db.get().clockOffsetMs;
  const channels = () => loadChannels({ env, baseUrl: origin });

  // Background jobs run one at a time so they never interleave their reads and writes.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn);
    chain = run.catch((err) => console.error("background job failed:", err.message));
    return run;
  };
  const tick = () => serial(() => runDue({ db, nowMs: nowMs(), env, fetchImpl }));
  const pull = () => serial(async () => (mockEnabled ? mockPull({ db, fetchImpl, baseUrl: origin, nowMs: nowMs() }) : undefined));
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

  const requireAdmin = (req) => {
    if (!remote) return;
    const given = Buffer.from(String(req.headers["x-admin-token"] ?? ""));
    const want = Buffer.from(env.ADMIN_TOKEN);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(401, "admin token required");
  };

  // ---------- handlers: return { status, body } for JSON or { raw, type } for other content
  const availability = () => ({
    today: todayISO(nowMs()),
    // public: no names, no contact details, only what the calendar needs
    bookings: db.get().bookings.filter(isActive).map(({ roomId, checkIn, checkOut, status }) => ({ roomId, checkIn, checkOut, status })),
  });

  async function createBooking(req) {
    const input = await readJson(req);
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

  async function cancelBooking(req, url, [code]) {
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
          exportUrls: Object.fromEntries(ROOMS.map((r) => [r.id, `${origin}/ical/${r.id}.ics?exclude=${encodeURIComponent(c.name)}${token}`])),
        })),
        mock: mockEnabled ? { lastPull: state.mock.lastPull, reservations: state.mock.reservations.length, seen: Object.fromEntries(ROOMS.map((r) => [r.id, (state.mock.seen[r.id] ?? []).length])) } : null,
      },
    };
  }

  async function setClock(req) {
    const { days, reset } = await readJson(req);
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
    const input = await readJson(req);
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

  const icalFeed = (url, roomId, { exclude }) => {
    if (env.ICAL_TOKEN && url.searchParams.get("token") !== env.ICAL_TOKEN) throw new HttpError(403, "invalid feed token");
    if (!roomById(roomId)) throw new HttpError(404, "unknown room");
    return { raw: exportFeed(db.get().bookings, roomId, { exclude }), type: "text/calendar; charset=utf-8" };
  };

  // [method, path pattern, needs admin, handler]
  const routes = [
    ["GET", /^\/api\/availability$/, false, () => ({ body: availability() })],
    ["POST", /^\/api\/bookings$/, false, createBooking],
    ["GET", /^\/ical\/([a-z0-9-]+)\.ics$/, false, (req, url, [room]) => icalFeed(url, room, { exclude: url.searchParams.get("exclude") ?? undefined })],
    ["GET", /^\/mock\/booking\/([a-z0-9-]+)\.ics$/, false, (req, url, [room]) => {
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

  async function serveStatic(pathname, res, headOnly) {
    let path;
    try {
      path = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    } catch {
      throw new HttpError(400, "bad path");
    }
    if (path.includes("\0") || path.includes("..") || !(PAGES.has(path) || path.startsWith("/assets/"))) throw new HttpError(404, "not found");
    const file = resolve(rootDir, `.${path}`);
    if (!file.startsWith(resolve(rootDir) + sep)) throw new HttpError(404, "not found");
    let data;
    try {
      data = await readFile(file);
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "EISDIR") throw new HttpError(404, "not found");
      throw err;
    }
    res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache", ...SECURITY_HEADERS });
    res.end(headOnly ? undefined : data);
  }

  async function dispatch(req, res) {
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    if (!remote && !LOCAL_HOSTS.has(hostname)) throw new HttpError(403, "local access only");
    const url = new URL(req.url, "http://localhost");
    const safe = req.method === "GET" || req.method === "HEAD";
    if (!safe && req.headers.origin) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(req.headers.origin).host === req.headers.host;
      } catch { /* "null" or malformed origin: treated as cross-origin */ }
      if (!sameOrigin) throw new HttpError(403, "cross-origin request blocked");
    }
    for (const [method, pattern, admin, handler] of routes) {
      const match = method === req.method ? pattern.exec(url.pathname) : null;
      if (!match) continue;
      if (admin) requireAdmin(req);
      const out = await handler(req, url, match.slice(1));
      if (out.raw !== undefined) return send(res, 200, out.raw, out.type);
      return send(res, out.status ?? 200, out.body);
    }
    if (safe) return serveStatic(url.pathname, res, req.method === "HEAD");
    throw new HttpError(404, "not found");
  }

  const server = createServer(async (req, res) => {
    try {
      await dispatch(req, res);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, err.body);
      console.error(`${req.method} ${req.url} failed:`, err);
      return send(res, 500, { error: "internal error" });
    }
  });

  return {
    db, tick, sync, pull,
    get origin() { return origin; },
    listen: (port = 0) => new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(port, remote ? "0.0.0.0" : "127.0.0.1", () => {
        const actual = server.address().port;
        origin = `http://127.0.0.1:${actual}`;
        resolveListen(actual);
      });
    }),
    close: () => new Promise((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    }),
  };
}
