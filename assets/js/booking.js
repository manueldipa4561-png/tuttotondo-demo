// Booking flow: guests + dates → rooms → details → confirmation, in Italian or English.
// Availability and bookings live on the local server (see server/app.mjs); this file only draws the flow.
import { initSite, reducedMotion } from "./site.js";
import { ROOMS, roomById, PROPERTY } from "./data.js";
import {
  todayISO, toISO, parseISO, addDays, nightsBetween, allBookings, bookedNights, isRoomFree, freeRooms,
  roomsNeeded, quoteRooms, createBooking, fmtEuro, fmtDate, toICS, seats, peopleOf, MAX_GUESTS, MAX_NIGHTS, ready, refresh, apiError,
} from "./store.js";
import { STRINGS } from "./booking-i18n.js";

initSite();
await ready; // availability from the server before anything is drawn

const MAX_MONTHS_AHEAD = 18;
const ALT_SEARCH_DAYS = 10;
const ALT_MAX = 3;
const SAME_DAY_WARN_HOUR = 20;
const LANG_KEY = "fabri171.lang";
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const gsap = window.gsap;

// helper DOM: i dati inseriti dagli ospiti passano sempre da textContent
function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

if (apiError) $("[data-api-error]").hidden = false;

const today = todayISO();
let bookings = allBookings();
let nightsByRoom = Object.fromEntries(ROOMS.map((r) => [r.id, bookedNights(r.id, bookings)]));

// Someone else (or Booking.com) took a room while this page was open: reload availability and redraw.
async function reloadAvailability() {
  await refresh();
  bookings = allBookings();
  nightsByRoom = Object.fromEntries(ROOMS.map((r) => [r.id, bookedNights(r.id, bookings)]));
}
const wide = matchMedia("(min-width: 721px)");

const firstOfMonth = (iso) => `${iso.slice(0, 8)}01`;
const addMonths = (first, n) => {
  const d = parseISO(first);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
const lastBookable = addMonths(firstOfMonth(today), MAX_MONTHS_AHEAD);
const validDate = (s) => ISO_RE.test(s ?? "") && !Number.isNaN(parseISO(s).getTime()) && toISO(parseISO(s)) === s && s >= today && s < lastBookable;

// ---------- lingua (?lang=en, poi preferenza salvata)
const params = new URLSearchParams(location.search);
let lang = (() => {
  const q = params.get("lang");
  if (q === "en" || q === "it") return q;
  try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "it"; } catch { return "it"; } // preferenza facoltativa
})();
const t = (key, vars = {}) => (STRINGS[lang][key] ?? STRINGS.it[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
const plural = (n, one, many) => t(n === 1 ? one : many);
const locale = () => (lang === "en" ? "en-GB" : "it-IT");
const longDate = (iso) => fmtDate(iso, { weekday: "short", day: "numeric", month: "long" }, locale());
const shortDate = (iso) => fmtDate(iso, { day: "numeric", month: "short" }, locale());
const errKey = (code) => `err${code[0].toUpperCase()}${code.slice(1)}`;
const roomType = (room) => (lang === "en" ? room.en.type : room.type);
const roomFeatures = (room) => (lang === "en" ? room.en.features : room.features);

function applyStatic() {
  document.documentElement.lang = lang;
  document.title = t("title");
  $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml))); // solo testi del dizionario
  $$("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $$("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  const toggle = $("[data-lang-toggle]");
  toggle.textContent = t("langSwitch");
  toggle.lang = lang === "en" ? "it" : "en";
}

$("[data-lang-toggle]").addEventListener("click", () => {
  lang = lang === "en" ? "it" : "en";
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* preferenza non salvata: la lingua resta per questa visita */ }
  const url = new URL(location.href);
  url.searchParams.set("lang", lang);
  history.replaceState(null, "", url);
  applyStatic();
  renderAll();
  if (state.result) renderTicket();
});

// ---------- stato
const state = {
  step: 1, maxStep: 1, done: false, result: null,
  checkIn: null, checkOut: null, view: firstOfMonth(today), focus: null, message: "", notice: null,
  party: { adults: 2, children: 0, infants: 0 },
  prefRoom: null, roomIds: [],
};
const needed = () => roomsNeeded(state.party);
const filterRoom = () => (needed() === 1 ? state.prefRoom : null); // ?camera= vale solo se basta una camera

function guestsText(party = state.party) {
  const { adults, children, infants } = party;
  return [
    t("gAdults", { n: adults, w: plural(adults, "adult", "adultsW") }),
    children ? t("gChildren", { n: children, w: plural(children, "child", "childrenW") }) : null,
    infants ? t("gInfants", { n: infants, w: plural(infants, "infant", "infantsW") }) : null,
  ].filter(Boolean).join(", ");
}

// ---------- availability for the party: rooms differ in size, so we count free seats, not free rooms
const people = () => peopleOf(state.party);
const seatsIn = (rooms) => rooms.reduce((n, r) => n + r.guests, 0);
const freeSeatsOn = (iso) => seatsIn(ROOMS.filter((r) => !nightsByRoom[r.id].has(iso)));
const nightFull = (iso) => (filterRoom() ? nightsByRoom[filterRoom()].has(iso) : freeSeatsOn(iso) < people());
function rangeOk(a, b) {
  const n = nightsBetween(a, b);
  if (n < 1 || n > MAX_NIGHTS) return false;
  return filterRoom() ? isRoomFree(filterRoom(), a, b, bookings) : seatsIn(freeRooms(a, b, bookings)) >= people();
}
// ultima partenza possibile da un arrivo (le notti libere sono contigue: appena una manca ci si ferma)
function maxCheckout(a) {
  let last = null;
  for (let n = 1; n <= MAX_NIGHTS; n++) {
    const b = addDays(a, n);
    if (!rangeOk(a, b)) break;
    last = b;
  }
  return last;
}
function alternatives(a, b) {
  const nights = nightsBetween(a, b);
  const found = [];
  const shorter = validDate(a) && maxCheckout(a);
  if (shorter) found.push([a, shorter]);
  for (let d = 1; d <= ALT_SEARCH_DAYS && found.length < ALT_MAX; d++) {
    for (const start of [addDays(a, d), addDays(a, -d)]) {
      const end = addDays(start, nights);
      if (found.length < ALT_MAX && start >= today && validDate(end) && rangeOk(start, end)) found.push([start, end]);
    }
  }
  return found;
}

// ---------- precompilazione da URL (?arrivo=&partenza=&adulti=&camera=&lang=)
(function readParams() {
  state.prefRoom = roomById(params.get("camera"))?.id ?? null;
  const adults = Number(params.get("adulti"));
  if (Number.isInteger(adults) && adults >= 1 && adults <= MAX_GUESTS) state.party.adults = adults;
  const [a, b] = [params.get("arrivo"), params.get("partenza")];
  if (validDate(a)) state.view = firstOfMonth(a);
  if (validDate(a) && validDate(b) && b > a) {
    if (rangeOk(a, b)) Object.assign(state, { checkIn: a, checkOut: b, step: 2, maxStep: 2 });
    else state.notice = { in: a, out: b };
  }
  if (state.prefRoom && needed() === 1) state.roomIds = [state.prefRoom];
})();

// ---------- ospiti
function renderGuests() {
  $$("[data-counter]").forEach((row) => {
    const key = row.dataset.counter;
    const value = state.party[key];
    $("output", row).textContent = value;
    const [minus, plus] = $$("[data-delta]", row);
    const more = { ...state.party, [key]: value + 1 };
    minus.disabled = value <= Number(row.dataset.min);
    plus.disabled = peopleOf(more) > MAX_GUESTS || more.infants > ROOMS.length;
  });
  const full = peopleOf(state.party) >= MAX_GUESTS;
  $("[data-rooms-needed]").textContent = `${t("roomsNeeded", { k: needed() })}${full ? ` ${t("bigGroup")}` : ""}`;
}

$$("[data-counter]").forEach((row) =>
  row.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-delta]");
    if (!btn || btn.disabled) return;
    const key = row.dataset.counter;
    state.party = { ...state.party, [key]: state.party[key] + Number(btn.dataset.delta) };
    // date ancora valide per il nuovo gruppo? altrimenti avvisa e proponi alternative
    if (state.checkIn && state.checkOut && !rangeOk(state.checkIn, state.checkOut)) {
      state.notice = { in: state.checkIn, out: state.checkOut };
      Object.assign(state, { checkIn: null, checkOut: null });
    }
    state.maxStep = Math.min(state.maxStep, state.checkOut ? 2 : 1);
    renderAll();
  }),
);

// ---------- calendario (tastiera: frecce, Home/Fine, PagSu/PagGiù)
const months = $("[data-cal-months]");
const hint = $("[data-cal-hint]");

function renderCalendar() {
  const count = wide.matches ? 2 : 1;
  months.replaceChildren(...Array.from({ length: count }, (_, i) => renderMonth(addMonths(state.view, i))));
  $("[data-cal-prev]").disabled = state.view <= firstOfMonth(today);
  $("[data-cal-next]").disabled = addMonths(state.view, count) >= lastBookable;
  const days = $$(".day", months);
  const tabbable = days.find((d) => d.dataset.date === state.focus) ?? days.find((d) => d.classList.contains("is-start"))
    ?? days.find((d) => d.getAttribute("aria-disabled") !== "true") ?? days[0];
  if (tabbable) tabbable.tabIndex = 0;
  renderHint();
  renderFilter();
  renderNotice();
  $("[data-cal-reset]").hidden = !state.checkIn;
}

function renderMonth(first) {
  const title = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(parseISO(first));
  const weekdays = lang === "en" ? ["M", "T", "W", "T", "F", "S", "S"] : ["L", "M", "M", "G", "V", "S", "D"];
  const grid = h("div", { className: "month__grid" }, ...weekdays.map((d) => h("span", { textContent: d, ariaHidden: "true" })));
  const offset = (parseISO(first).getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i++) grid.append(h("i"));
  for (let iso = first; iso.slice(0, 7) === first.slice(0, 7); iso = addDays(iso, 1)) grid.append(dayButton(iso));
  return h("div", { className: "month" }, h("h3", { className: "month__title", textContent: title }), grid);
}

function dayButton(iso) {
  const { checkIn: a, checkOut: b } = state;
  const asCheckout = Boolean(a && !b && iso > a && rangeOk(a, iso));
  const full = nightFull(iso) && !asCheckout;
  const past = iso < today || iso >= lastBookable;
  const btn = h("button", { type: "button", className: "day", textContent: String(Number(iso.slice(8))), tabIndex: -1 });
  btn.dataset.date = iso;
  btn.classList.toggle("is-full", full && !past);
  btn.classList.toggle("is-today", iso === today);
  btn.classList.toggle("is-start", iso === a);
  btn.classList.toggle("is-end", iso === b);
  btn.classList.toggle("is-range", Boolean(a && b && iso > a && iso < b));
  btn.classList.toggle("is-blocked", Boolean(a && !b && iso > a && !asCheckout));
  btn.setAttribute("aria-disabled", String(past || full));
  btn.setAttribute("aria-pressed", String(iso === a || iso === b));
  const status = iso === a ? t("dayIn") : iso === b ? t("dayOut") : full ? t("dayFull") : asCheckout ? t("dayCheckout") : "";
  btn.setAttribute("aria-label", status ? `${longDate(iso)}, ${status}` : longDate(iso));
  return btn;
}

function renderHint() {
  const { checkIn: a, checkOut: b } = state;
  let text = state.message;
  if (!text && !a) text = t("hintIn");
  else if (!text && !b) {
    const max = maxCheckout(a);
    text = max ? t("hintOut", { in: longDate(a), max: longDate(max) }) : t("hintNone", { in: longDate(a), guests: guestsText() });
  } else if (!text) {
    const n = nightsBetween(a, b);
    text = t("hintRange", { n, nights: plural(n, "night", "nights"), in: longDate(a), out: longDate(b) });
  }
  hint.textContent = text;
}

function renderFilter() {
  const box = $("[data-cal-filter]");
  const room = roomById(filterRoom());
  box.hidden = !room || state.step !== 1;
  if (box.hidden) return;
  const showAll = h("button", { type: "button", className: "link-btn link-btn--ink", textContent: t("filterAll") });
  showAll.addEventListener("click", () => {
    state.prefRoom = null;
    state.roomIds = [];
    renderAll();
  });
  const swatch = h("i");
  swatch.style.background = room.color;
  box.replaceChildren(swatch, t("filter", { room: room.name }), " ", showAll);
}

function renderNotice() {
  const box = $("[data-cal-notice]");
  box.hidden = !state.notice;
  if (!state.notice) return;
  const { in: a, out: b } = state.notice;
  const alts = alternatives(a, b);
  const buttons = alts.map(([x, y]) => {
    const btn = h("button", { type: "button", className: "chip-btn", textContent: `${shortDate(x)} → ${shortDate(y)}` });
    btn.addEventListener("click", () => {
      Object.assign(state, { checkIn: x, checkOut: y, view: firstOfMonth(x), notice: null, message: "" });
      renderAll();
      $("[data-next='2']").focus();
    });
    return btn;
  });
  box.replaceChildren(
    h("p", { textContent: t("notice", { in: shortDate(a), out: shortDate(b), guests: guestsText() }) }),
    alts.length ? h("p", { className: "cal__alts" }, h("span", { textContent: t("noticeTry") }), ...buttons) : h("p", { textContent: t("noticeNone") }),
  );
}

function pick(iso) {
  const { checkIn: a, checkOut: b } = state;
  state.message = "";
  if (a && !b && iso > a) {
    if (rangeOk(a, iso)) state.checkOut = iso;
    else {
      // niente reset silenzioso dell'arrivo: spieghiamo fin dove si può arrivare
      const max = maxCheckout(a);
      state.message = max ? t("blocked", { d: longDate(iso), in: longDate(a), max: longDate(max) }) : t("hintNone", { in: longDate(a), guests: guestsText() });
    }
  } else if (!nightFull(iso)) Object.assign(state, { checkIn: iso, checkOut: null });
  Object.assign(state, { focus: iso, notice: null, maxStep: 1 });
  renderAll();
  focusDay(iso);
}

const focusDay = (iso) => $(`.day[data-date="${iso}"]`, months)?.focus();
function moveFocus(iso) {
  const target = iso < today ? today : iso >= lastBookable ? addDays(lastBookable, -1) : iso;
  const count = wide.matches ? 2 : 1;
  if (target < state.view) state.view = firstOfMonth(target);
  else if (firstOfMonth(target) > addMonths(state.view, count - 1)) state.view = addMonths(firstOfMonth(target), 1 - count);
  state.focus = target;
  renderCalendar();
  focusDay(target);
}

months.addEventListener("click", (e) => {
  const day = e.target.closest(".day");
  if (day && day.getAttribute("aria-disabled") !== "true") pick(day.dataset.date);
});
months.addEventListener("keydown", (e) => {
  const day = e.target.closest(".day");
  if (!day) return;
  const iso = day.dataset.date;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  const dow = (parseISO(iso).getUTCDay() + 6) % 7;
  let target = null;
  if (step) target = addDays(iso, step);
  else if (e.key === "Home") target = addDays(iso, -dow);
  else if (e.key === "End") target = addDays(iso, 6 - dow);
  else if (e.key === "PageUp" || e.key === "PageDown") {
    const d = parseISO(iso);
    target = toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (e.key === "PageUp" ? -1 : 1), d.getUTCDate())));
  }
  if (!target) return;
  e.preventDefault();
  moveFocus(target);
});
months.addEventListener("pointerover", (e) => {
  const day = e.target.closest(".day");
  if (!day || !state.checkIn || state.checkOut) return;
  const end = day.dataset.date;
  const ok = end > state.checkIn && rangeOk(state.checkIn, end);
  $$(".day", months).forEach((d) => d.classList.toggle("is-preview", ok && d.dataset.date > state.checkIn && d.dataset.date <= end));
});
$("[data-cal-prev]").addEventListener("click", () => { state.view = addMonths(state.view, -1); renderCalendar(); });
$("[data-cal-next]").addEventListener("click", () => { state.view = addMonths(state.view, 1); renderCalendar(); });
$("[data-cal-reset]").addEventListener("click", () => {
  Object.assign(state, { checkIn: null, checkOut: null, message: "", maxStep: 1 });
  renderAll();
  months.querySelector(".day[tabindex='0']")?.focus();
});
wide.addEventListener("change", renderCalendar);

function renderSameDay() {
  const box = $("[data-same-day]");
  box.hidden = !(state.checkIn === today && new Date().getHours() >= SAME_DAY_WARN_HOUR);
  if (box.hidden) return;
  box.replaceChildren(t("sameDayLate"), " ", h("a", { href: `tel:${PROPERTY.phone.replace(/\s/g, "")}`, textContent: PROPERTY.phone }));
}

// ---------- camere (una o più)
const roomsWrap = $("[data-rooms-pick]");

function renderRooms() {
  if (!state.checkIn || !state.checkOut) return;
  const free = freeRooms(state.checkIn, state.checkOut, bookings).map((r) => r.id);
  state.roomIds = state.roomIds.filter((id) => free.includes(id));
  const k = needed();
  $("[data-rooms-lead]").textContent = t("s2lead", {
    free: free.length, freeWord: plural(free.length, "roomFree", "roomsFree"),
    in: longDate(state.checkIn), out: longDate(state.checkOut), guests: guestsText(), k, kWord: plural(k, "room", "rooms"),
  });
  const n = nightsBetween(state.checkIn, state.checkOut);
  roomsWrap.replaceChildren(...ROOMS.map((room) => {
    const isFree = free.includes(room.id);
    const input = h("input", { type: "checkbox", name: "room", value: room.id, disabled: !isFree, checked: state.roomIds.includes(room.id) });
    const label = h("label", { className: `pick${isFree ? "" : " is-disabled"}` },
      input,
      h("span", { className: "pick__img" }, h("img", { src: `assets/img/${room.images[0]}-800.jpg`, alt: "", loading: "lazy" })),
      h("span", { className: "pick__body" },
        h("span", { className: "pick__name", textContent: room.name }),
        h("span", { className: "pick__type mono", textContent: `${roomType(room)} · ${t("pickCap", { n: room.guests })}` }),
        h("span", { className: "pick__feat", textContent: roomFeatures(room).join(" · ") }),
        h("span", { className: "pick__status mono", textContent: isFree ? t("pickFree") : t("pickBusy") })),
      h("span", { className: "pick__price" },
        h("b", { textContent: fmtEuro(room.rate * n) }),
        h("small", { textContent: t("pickPrice", { n, nights: plural(n, "night", "nights"), rate: fmtEuro(room.rate) }) })));
    label.style.setProperty("--room", room.color);
    return label;
  }));
  $("[data-pick-count]").textContent = t("pickCount", { s: seats(state.roomIds), k: people() });
}

roomsWrap.addEventListener("change", (e) => {
  const id = e.target.value;
  const chosen = e.target.checked ? [...state.roomIds, id] : state.roomIds.filter((x) => x !== id);
  state.roomIds = ROOMS.map((r) => r.id).filter((x) => chosen.includes(x)); // ordine stabile
  state.maxStep = 2;
  renderAll();
  roomsWrap.querySelector(`input[value="${id}"]`)?.focus(); // il re-render distrugge il checkbox a fuoco
});

// ---------- riepilogo (laterale su desktop, barra fissa su mobile)
function renderSummary() {
  const rooms = state.roomIds.map(roomById);
  const [first] = rooms;
  const media = $("[data-sum-media]");
  if (first) media.replaceChildren(h("img", { src: `assets/img/${first.images[0]}-800.jpg`, alt: rooms.map((r) => r.name).join(", ") }));
  else media.replaceChildren(h("span", { className: "mono", textContent: t("sumNoRoom") }));
  $("[data-summary]").style.setProperty("--room", first?.color ?? "var(--paper-2)");
  $("[data-sum-type]").textContent = !first ? t("sumTitle") : rooms.length > 1 ? `${rooms.length} ${t("rooms")}` : roomType(first);
  $("[data-sum-room]").textContent = first ? rooms.map((r) => r.name).join(" + ") : t("sumEmpty");
  $("[data-sum-in]").textContent = state.checkIn ? longDate(state.checkIn) : "—";
  $("[data-sum-out]").textContent = state.checkOut ? longDate(state.checkOut) : "—";
  $("[data-sum-guests]").textContent = guestsText();
  const price = $("[data-sum-price]");
  const bar = $("[data-mobile-total]");
  price.hidden = !(first && state.checkIn && state.checkOut);
  bar.hidden = price.hidden || state.done;
  if (price.hidden) return;
  const q = quoteRooms(state.roomIds, state.checkIn, state.checkOut);
  const nightsWord = plural(q.nights, "night", "nights");
  $("[data-sum-lines]").replaceChildren(...q.lines.map((l) =>
    h("div", { className: "summary__line" }, h("span", { textContent: `${l.room.name} · ${l.nights} ${nightsWord} × ${fmtEuro(l.rate)}` }), h("span", { textContent: fmtEuro(l.total) }))));
  $("[data-sum-portal]").textContent = fmtEuro(q.portal);
  $("[data-sum-total]").textContent = fmtEuro(q.total);
  $("[data-sum-save]").textContent = t("sumSave", { x: fmtEuro(q.saving) });
  $("[data-mt-label]").textContent = t("mobileLabel", { rooms: rooms.map((r) => r.name).join(" + "), n: q.nights, nights: nightsWord, x: fmtEuro(q.saving) });
  $("[data-mt-total]").textContent = `${fmtEuro(q.total)} →`;
}

// la barra mobile porta avanti di un passo (o al bottone di conferma), non solo al riepilogo
$("[data-mobile-total]").addEventListener("click", (e) => {
  const next = $(`[data-step="${state.step}"] [data-next]:not(:disabled)`) ?? $(`[data-step="${state.step}"] [type="submit"]`);
  if (!next) return;
  e.preventDefault();
  if (next.type === "submit") next.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  else next.click();
});

// ---------- passi
function goTo(step) {
  if (step > state.maxStep) return;
  state.step = step;
  $$("[data-step]").forEach((s) => (s.hidden = Number(s.dataset.step) !== step));
  renderAll();
  const current = $(`[data-step="${step}"]`);
  if (gsap && !reducedMotion) gsap.from(current, { y: 24, opacity: 0, duration: 0.8, ease: "expo.out" });
  const top = $(".stepper").getBoundingClientRect().top + scrollY - 90;
  if (scrollY > top) scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  (step === 4 ? current : $("h2", current))?.focus({ preventScroll: true });
}

function renderStepper() {
  $$(".stepper button").forEach((btn) => {
    const n = Number(btn.dataset.goto);
    btn.disabled = state.done ? n !== 4 : n > state.maxStep;
    if (n === state.step) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
  });
  $('[data-next="2"]').disabled = !(state.checkIn && state.checkOut);
  $('[data-next="3"]').disabled = seats(state.roomIds) < people();
}

function renderAll() {
  if (state.checkIn && state.checkOut) state.maxStep = Math.max(state.maxStep, 2);
  if (state.step >= 2 && seats(state.roomIds) >= people()) state.maxStep = Math.max(state.maxStep, 3);
  renderGuests();
  renderCalendar();
  renderSameDay();
  renderRooms();
  renderSummary();
  renderStepper();
}

document.addEventListener("click", (e) => {
  const next = e.target.closest("[data-next]");
  const back = e.target.closest("[data-goto]");
  if (next && !next.disabled) {
    const n = Number(next.dataset.next);
    state.maxStep = Math.max(state.maxStep, n);
    goTo(n);
  } else if (back && !back.disabled) {
    goTo(Number(back.dataset.goto));
  }
});

// ---------- dati + conferma
const form = $("[data-form]");
const toggleBlock = (toggleSel, blockSel) => $(toggleSel).addEventListener("change", (e) => ($(blockSel).hidden = !e.target.checked));
toggleBlock("[data-invoice-toggle]", "[data-invoice]");

form.addEventListener("input", (e) => {
  e.target.removeAttribute("aria-invalid");
  const msg = $(`[data-error="${e.target.name}"]`, form);
  if (msg) msg.textContent = "";
});

const FORM_FIELDS = ["firstName", "lastName", "email", "phone", "vat"];
const FLOW_FIELDS = ["guests", "rooms", "dates"];

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  $$("[data-error]", form).forEach((el) => (el.textContent = ""));
  $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
  const data = Object.fromEntries(new FormData(form));
  if (!data.contact) {
    // WhatsApp is opt-in: the guest must pick WhatsApp or email, there is no pre-selected answer
    $('[data-error="contact"]', form).textContent = t("errContact");
    form.querySelector('input[name="contact"]').focus();
    return;
  }
  const submit = $("[type='submit']", form);
  submit.disabled = true;
  try {
    const result = await createBooking({
      roomIds: state.roomIds, checkIn: state.checkIn, checkOut: state.checkOut, ...state.party, payment: data.payment,
      invoice: data.invoiceOn ? { company: data.company?.trim() ?? "", vat: data.vat?.trim() ?? "", sdi: data.sdi?.trim() ?? "" } : null,
      guest: {
        firstName: data.firstName, lastName: data.lastName, email: data.email, phone: data.phone, arrival: data.arrival,
        notes: data.notes?.trim() ?? "", lang, whatsapp: data.contact === "whatsapp", // explicit choice = the guest's opt-in
      },
    });
    state.result = { ...result, firstName: data.firstName.trim() };
    showDone();
  } catch (err) {
    if (!err.fields) {
      console.error("Booking failed", err);
      $("#e-form").textContent = t("errServer");
      return;
    }
    if (err.fields.rooms === "roomTaken") {
      await reloadAvailability();
      renderAll();
      goTo(2);
    }
    const invalid = Object.keys(err.fields).filter((f) => FORM_FIELDS.includes(f));
    invalid.forEach((name) => {
      $(`[data-error="${name}"]`, form).textContent = t(errKey(err.fields[name]));
      form.elements[name]?.setAttribute("aria-invalid", "true");
    });
    const flow = FLOW_FIELDS.filter((f) => err.fields[f]).map((f) => t(errKey(err.fields[f])));
    const summary = invalid.length ? t("errSummary", { n: invalid.length, fieldsWord: plural(invalid.length, "field", "fields") }) : "";
    $("#e-form").textContent = [summary, ...flow].filter(Boolean).join(" ");
    (form.querySelector('[aria-invalid="true"]') ?? $("#e-form")).focus?.();
  } finally {
    submit.disabled = false;
  }
});

function renderTicket() {
  const { code, bookings: list, total, firstName } = state.result;
  const [b] = list;
  const rooms = list.map((x) => roomById(x.roomId));
  $("[data-done-title]").textContent = t("doneTitle", { name: firstName });
  const rows = [
    [t("tRooms"), rooms.map((r) => `${r.name} — ${roomType(r)}`).join(" · ")],
    [t("tIn"), t("tInVal", { d: longDate(b.checkIn) })],
    [t("tOut"), t("tOutVal", { d: longDate(b.checkOut) })],
    [t("tGuests"), guestsText(b.party)],
    [t("tTotal"), `${fmtEuro(total)} · ${t(b.payment === "bonifico" ? "tPayWire" : "tPayHere")}`],
    [t("tWhere"), `${PROPERTY.address}, ${PROPERTY.city}`],
  ];
  const ticket = $("[data-ticket]");
  ticket.style.setProperty("--room", rooms[0].color);
  const dl = h("dl", {}, ...rows.map(([k, v]) => h("div", {}, h("dt", { textContent: k }), h("dd", { textContent: v }))));
  const notes = [t("tCancel"), b.guest.whatsapp ? t("tWhatsApp") : t("tNote", { email: b.guest.email })];
  const help = h("p", { className: "ticket__help" }, `${t("tHelp")} `,
    h("a", { href: `tel:${PROPERTY.phone.replace(/\s/g, "")}`, textContent: PROPERTY.phone }), " · ",
    h("a", { href: `https://wa.me/${PROPERTY.whatsapp}`, target: "_blank", rel: "noopener", textContent: "WhatsApp" }));
  ticket.replaceChildren(h("span", { className: "thread" }), h("p", { className: "ticket__code", textContent: code }), dl,
    ...notes.map((n) => h("p", { className: "ticket__note", textContent: n })), help);
  const ics = $("[data-ics]");
  if (ics.href.startsWith("blob:")) URL.revokeObjectURL(ics.href);
  ics.href = URL.createObjectURL(new Blob([toICS(state.result)], { type: "text/calendar" }));
  ics.download = `fabri171-${code}.ics`;
  $("[data-another]").href = `prenota.html?lang=${lang}`;
}

function showDone() {
  state.done = true;
  state.maxStep = 4;
  renderTicket();
  goTo(4);
  if (gsap && !reducedMotion) gsap.from("[data-ticket]", { rotate: -3, y: 60, opacity: 0, duration: 1.2, ease: "expo.out", delay: 0.1 });
}

// ---------- avvio
applyStatic();
$$("[data-step]").forEach((s) => (s.hidden = Number(s.dataset.step) !== state.step));
renderAll();
