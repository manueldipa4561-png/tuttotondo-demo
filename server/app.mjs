// Node adapter: an http server around the booking API in ../assets/js/api/core.js, plus the static pages.
// Everything that is not HTTP (routes, validation, WhatsApp scheduling, channel sync) lives in core.js.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { HttpError, createCore } from "../assets/js/api/core.js";
import { seedState } from "../assets/js/api/seed.js";
import { openDb } from "./db.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PAGES = new Set(["/index.html", "/prenota.html", "/gestione.html"]);
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

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

export async function createApp({ rootDir, dataDir, env = process.env, fetchImpl = fetch, now = Date.now }) {
  const remote = env.ALLOW_REMOTE === "1";
  if (remote && !env.ADMIN_TOKEN) throw new Error("ALLOW_REMOTE=1 requires ADMIN_TOKEN: the host console must never be open to the internet.");
  const db = await openDb(join(dataDir, "db.json"), () => seedState({ nowMs: now() }));
  let origin = "";
  const core = createCore({ db, env, fetchImpl, now, getOrigin: () => origin });

  const requireAdmin = (req) => {
    if (!remote) return;
    const given = Buffer.from(String(req.headers["x-admin-token"] ?? ""));
    const want = Buffer.from(env.ADMIN_TOKEN);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(401, "admin token required");
  };

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
    const out = await core.handle({ method: req.method, pathname: url.pathname, search: url.searchParams, json: () => readJson(req), authorize: () => requireAdmin(req) });
    if (out?.raw !== undefined) return send(res, 200, out.raw, out.type);
    if (out) return send(res, out.status ?? 200, out.body);
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
    db, tick: core.tick, sync: core.sync, pull: core.pull,
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
