// Browser side of the booking engine. Same function names the pages already use, backed by the local API:
// availability lives on the server, so two guests (or a guest and Booking.com) can never take the same room.
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

async function request(path, options) {
  const headers = { "content-type": "application/json" };
  if (path.startsWith("/api/admin/") && adminToken()) headers["x-admin-token"] = adminToken();
  const res = await fetch(path, { headers, ...options });
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
    console.error("API non raggiungibile: avvia il server con `npm start`.", err);
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
