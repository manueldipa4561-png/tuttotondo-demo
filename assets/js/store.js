// Browser side of the booking engine. Same function names the pages already use, backed by the API (the local server, or
// the in-browser demo backend on a static host): availability is decided in one place, so two guests (or a guest and
// Booking.com) can never take the same room.
import * as engine from "./engine.js";

export * from "./engine.js";

let cache = { bookings: [], today: engine.todayISO() };
export let apiError = null;

function adminToken() {
  try {
    return sessionStorage.getItem("adminToken");
  } catch {
    return null; // storage blocked: only matters when the console runs behind ALLOW_REMOTE
  }
}

// Without a server behind the page (a static host answers /api with an HTML 404, or not at all) the same API runs inside
// the browser: demo-backend.js. One probe of the public availability route decides, once, for every request after it.
let probe = null; // resolves to true when a real API answers
let demoBackend = null;
let useDemo = false;
export const isDemo = () => useDemo;

async function serverIsThere() {
  try {
    const res = await fetch("/api/availability");
    return Boolean(res.headers.get("content-type")?.includes("application/json")); // a real API answers in JSON, even its errors
  } catch {
    return false;
  }
}

async function send(path, init) {
  probe ??= serverIsThere().then((found) => {
    useDemo = !found;
    return found;
  });
  if (await probe) return fetch(path, init);
  demoBackend ??= import("./demo-backend.js").then((m) => m.startDemoBackend());
  return (await demoBackend).fetch(path, init);
}

async function request(path, options) {
  const headers = { "content-type": "application/json" };
  if (path.startsWith("/api/admin/") && adminToken()) headers["x-admin-token"] = adminToken();
  const res = await send(path, { headers, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `http ${res.status}`), { fields: body.fields, status: res.status });
  return body;
}

export async function refresh() {
  try {
    cache = await request("/api/availability");
    apiError = null;
  } catch (err) {
    apiError = err;
    console.error("API non raggiungibile.", err);
  }
  return cache;
}

export const ready = refresh();
export const allBookings = () => cache.bookings;
export const todayISO = () => cache.today; // the server's "today" (it can be advanced for demos)

export async function createBooking(input) {
  const result = await request("/api/bookings", { method: "POST", body: JSON.stringify(input) });
  await refresh();
  return result;
}

// ---------- host console (admin endpoints)
export const adminBookings = () => request("/api/admin/bookings");
export const getChannels = () => request("/api/admin/channels");
export const getOutbox = () => request("/api/admin/outbox");
export const adminPost = (path, body = {}) => request(`/api/admin/${path}`, { method: "POST", body: JSON.stringify(body) });
export const cancelBooking = (code) => adminPost(`bookings/${encodeURIComponent(code)}/cancel`);
