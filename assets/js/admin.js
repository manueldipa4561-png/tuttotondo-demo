// Host console: KPIs, channel sync, WhatsApp outbox, planning and bookings. Talks to the local API (server/app.mjs).
import { initSite } from "./site.js";
import { ROOMS, roomById } from "./data.js";
import { adminBookings, getChannels, getOutbox, adminPost, cancelBooking, isDemo } from "./store.js";
import { addDays, nightsBetween, eachNight, fmtEuro, fmtDate, parseISO, isActive, OTA_COMMISSION, CHANNEL_DIRECT, CHANNEL_BOOKING, CHANNEL_PHONE } from "./engine.js";

initSite();

const PLAN_DAYS = 21;
const KPI_DAYS = 30;
const UPCOMING_DAYS = 14;
const REFRESH_MS = 8000;
const OUTBOX_GROUPS = 8;
const MOCK_MAX_NIGHTS = 5;
const $ = (sel) => document.querySelector(sel);

// tiny DOM helper: guest data always goes through textContent
function h(tag, props = {}, ...children) {
  const { style, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  Object.entries(style ?? {}).forEach(([k, v]) => el.style.setProperty(k, v));
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}
const roomVars = (room) => ({ "--room": room.color, "--room-fg": room.dark ? "#fffaf3" : "#17140f" });
const isDirect = (b) => b.channel === CHANNEL_DIRECT;
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const CHANNEL_CODE = { [CHANNEL_BOOKING]: "BKG", [CHANNEL_PHONE]: "TEL", [CHANNEL_DIRECT]: "WEB" };
const KIND_LABEL = {
  booking_confirmed: "Conferma", pre_arrival: "Istruzioni e codice porta, 2 giorni prima", checkin_day: "Giorno dell'arrivo",
  checkout_thanks: "Grazie e recensione", host_new_booking: "Avviso al gestore", host_conflict: "Doppia prenotazione",
};
const STATUS_LABEL = { sent: "inviato", scheduled: "programmato", cancelled: "annullato", failed: "non inviato" };
const dateTime = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
const timeOnly = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Rome" });

let snapshot = null;
const say = (text, isError = false) => {
  const el = $("[data-status]");
  el.textContent = text;
  el.classList.toggle("is-error", isError);
};

// on a page hosted without a server the data lives in this browser: say so, instead of "demo in locale"
function markDemo() {
  $("[data-demo-note]").hidden = !isDemo();
  if (isDemo()) $(".admin__head .eyebrow").textContent = "Area gestore · demo nel browser";
}

async function load() {
  try {
    const [book, channels, outbox] = await Promise.all([adminBookings(), getChannels(), getOutbox()]);
    snapshot = { today: book.today, bookings: book.bookings, channels, outbox };
    render();
    markDemo();
  } catch (err) {
    if (err.status === 401 && !sessionStorage.getItem("adminToken")) {
      const token = prompt("Token gestore (ADMIN_TOKEN)");
      if (token) {
        sessionStorage.setItem("adminToken", token);
        return load();
      }
    }
    say(`Non riesco a raggiungere il sistema (${err.message}). Riprova tra qualche istante.`, true);
  }
}

// run an action, show its outcome, reload everything
async function act(run, ok) {
  try {
    const result = await run();
    say(typeof ok === "function" ? ok(result) : ok);
  } catch (err) {
    say(err.message === "unavailable" ? "Booking.com non la vende: ha già letto il blocco sul nostro calendario." : `Errore: ${err.message}`, true);
  }
  await load();
}

function render() {
  const active = snapshot.bookings.filter(isActive);
  renderKpis(active);
  renderChannels();
  renderMock();
  renderClock();
  renderOutbox();
  renderPlan(active);
  renderTable();
}

function renderKpis(active) {
  const { today } = snapshot;
  const end = addDays(today, KPI_DAYS);
  const arrivals = active.filter((b) => b.checkIn >= today && b.checkIn < end).length;
  const nights = active.reduce((sum, b) => sum + eachNight(b.checkIn, b.checkOut).filter((n) => n >= today && n < end).length, 0);
  const occupancy = Math.round((nights / (ROOMS.length * KPI_DAYS)) * 100);
  const direct = active.filter(isDirect);
  const directRevenue = direct.reduce((sum, b) => sum + b.total, 0);
  const kpi = (label, value, note, thread) =>
    h("article", { className: `kpi${thread ? " kpi--thread" : ""}` }, thread ? h("span", { className: "thread" }) : null,
      h("p", { className: "eyebrow", textContent: label }), h("b", { textContent: value }), h("small", { textContent: note }));
  $("[data-kpis]").replaceChildren(
    kpi("Arrivi", String(arrivals), `nei prossimi ${KPI_DAYS} giorni`),
    kpi("Occupazione", `${occupancy}%`, `${nights} notti vendute su ${ROOMS.length * KPI_DAYS}`),
    kpi("Incasso dal sito", fmtEuro(directRevenue), `${direct.length} prenotazioni dirette`),
    kpi("Commissioni risparmiate", fmtEuro(Math.round(directRevenue * OTA_COMMISSION)), `stima al ${Math.round(OTA_COMMISSION * 100)}% rispetto ai portali`, true),
  );
}

// ---------- channels
function renderChannels() {
  const { channels } = snapshot.channels;
  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      say("Link copiato. Incollalo nella sezione calendario del portale.");
    } catch {
      say(url); // clipboard blocked: show the link so it can be copied by hand
    }
  };
  $("[data-channels]").replaceChildren(...channels.map((c) => {
    const r = c.lastResult;
    const last = c.lastSync
      ? `Ultima lettura ${timeOnly.format(Date.parse(c.lastSync))}: ${r.imported} nuove, ${r.updated} aggiornate, ${r.cancelled} annullate, ${r.conflicts} in conflitto.`
      : "Non ancora letto.";
    return h("div", {},
      h("div", { className: "panel__head" }, h("h3", { className: "panel__title", textContent: c.name }),
        h("span", { className: `badge${c.mock ? "" : " badge--web"}`, textContent: c.mock ? "Simulato" : "Collegato" })),
      h("p", { textContent: `${last} Rilettura automatica ogni 30 secondi.` }),
      c.errors?.length ? h("p", { className: "panel__error", textContent: `Non riesco a leggere: ${c.errors.join(" · ")}` }) : null,
      h("p", { className: "eyebrow", textContent: "Il nostro calendario, da dare al portale" }),
      h("ul", { className: "feeds" }, ...ROOMS.map((room) =>
        h("li", {}, h("span", { className: "swatch", style: roomVars(room) }), room.name,
          h("button", { className: "link-btn link-btn--ink", type: "button", textContent: "Copia link iCal", onclick: () => copy(c.exportUrls[room.id]) })))),
      h("p", { className: "panel__note", textContent: "I portali rileggono questi link da soli, di solito ogni 1–4 ore: non è istantaneo. Per questo le doppie prenotazioni vengono segnalate subito su WhatsApp." }),
      h("button", { className: "btn btn--sm", type: "button", textContent: "Sincronizza ora", onclick: () => act(() => adminPost("sync"), "Calendari riletti.") }));
  }));
}

function renderMock() {
  const box = $("[data-mock]");
  const { mock } = snapshot.channels;
  if (!mock) return box.replaceChildren(h("p", { className: "panel__note", textContent: "Simulatore spento: stai usando i calendari reali (CHANNEL_FEEDS_JSON)." }));
  const blocks = Object.values(mock.seen).reduce((n, count) => n + count, 0);
  const info = mock.lastPull
    ? `Booking.com ha letto il nostro calendario alle ${timeOnly.format(Date.parse(mock.lastPull))} e vede ${blocks} blocchi.`
    : "Booking.com non ha ancora letto il nostro calendario.";
  if (box.querySelector("form")) return void (box.querySelector("[data-mock-info]").textContent = info); // keep what is being typed
  const room = h("select", { name: "roomId", ariaLabel: "Camera" }, ...ROOMS.map((r) => h("option", { value: r.id, textContent: r.name })));
  const start = h("input", { type: "date", name: "start", required: true, ariaLabel: "Arrivo", min: snapshot.today, value: addDays(snapshot.today, 14) });
  const nightsSel = h("select", { name: "nights", ariaLabel: "Notti" }, ...Array.from({ length: MOCK_MAX_NIGHTS }, (_, i) => h("option", { value: String(i + 1), textContent: `${i + 1} ${i ? "notti" : "notte"}` })));
  const form = h("form", { className: "mock-form", onsubmit: (e) => {
    e.preventDefault();
    const end = addDays(start.value, Number(nightsSel.value));
    act(() => adminPost("mock/reserve", { roomId: room.value, start: start.value, end }), "Prenotazione arrivata su Booking.com: la leggiamo alla prossima sincronizzazione.");
  } }, room, start, nightsSel, h("button", { className: "btn btn--sm", type: "submit", textContent: "Prenota su Booking.com" }));
  const infoLine = h("p", { textContent: info });
  infoLine.dataset.mockInfo = "";
  box.replaceChildren(
    h("div", { className: "panel__head" }, h("h3", { className: "panel__title", textContent: "Prova il portale" }), h("span", { className: "badge", textContent: "Simulatore" })),
    h("p", { className: "panel__note", textContent: "Per vedere la protezione contro le doppie prenotazioni: prenota dal sito, poi simula subito una prenotazione su Booking.com per le stesse date, prima che rilegga il calendario." }),
    form,
    infoLine,
    h("button", { className: "btn btn--ghost btn--sm", type: "button", textContent: "Booking.com rilegge il nostro calendario", onclick: () => act(() => adminPost("mock/pull"), "Booking.com ha riletto il nostro calendario.") }));
}

// ---------- WhatsApp
function renderClock() {
  const { today, clockOffsetDays, whatsapp } = snapshot.channels;
  const jobs = snapshot.outbox.jobs;
  const sent = jobs.filter((j) => j.status === "sent").length;
  const waiting = jobs.filter((j) => j.status === "scheduled").length;
  const mode = whatsapp.mode === "cloud"
    ? "Collegato a WhatsApp Cloud API: i messaggi partono davvero."
    : "Modalità demo: i messaggi restano in questa pagina e non partono davvero. Per inviarli servono i dati di WhatsApp Business (token e numero).";
  const jump = (days) => act(() => adminPost("demo/clock", { days }), `Orologio demo avanzato di ${days} ${days === 1 ? "giorno" : "giorni"}.`);
  $("[data-clock]").replaceChildren(
    h("div", { className: "panel__head" }, h("h3", { className: "panel__title", textContent: "Messaggi" }),
      h("span", { className: `badge${whatsapp.mode === "cloud" ? " badge--web" : ""}`, textContent: whatsapp.mode === "cloud" ? "Reale" : "Demo" })),
    h("p", { textContent: mode }),
    h("p", { className: "panel__big", textContent: `${sent} inviati · ${waiting} programmati` }),
    h("p", { className: "eyebrow", textContent: "Orologio demo" }),
    h("p", { textContent: `Oggi: ${fmtDate(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${clockOffsetDays ? ` (+${clockOffsetDays} giorni)` : ""}` }),
    h("div", { className: "panel__row" },
      h("button", { className: "btn btn--sm", type: "button", textContent: "+1 giorno", onclick: () => jump(1) }),
      h("button", { className: "btn btn--sm", type: "button", textContent: "+1 settimana", onclick: () => jump(7) }),
      h("button", { className: "btn btn--ghost btn--sm", type: "button", disabled: !clockOffsetDays, textContent: "Torna a oggi", onclick: () => act(() => adminPost("demo/clock", { reset: true }), "Orologio demo riportato a oggi.") })),
    h("p", { className: "panel__note", textContent: "Avanza il tempo per vedere partire le istruzioni di arrivo, il messaggio del giorno e il ringraziamento." }));
}

function renderOutbox() {
  const byCode = new Map();
  for (const job of snapshot.outbox.jobs) byCode.set(job.code, [...(byCode.get(job.code) ?? []), job]);
  const groups = [...byCode.entries()]
    .map(([code, jobs]) => ({ code, jobs: jobs.sort((a, b) => a.sendAt.localeCompare(b.sendAt)) }))
    .sort((a, b) => b.jobs[0].sendAt.localeCompare(a.jobs[0].sendAt))
    .slice(0, OUTBOX_GROUPS);
  if (!groups.length) return $("[data-outbox]").replaceChildren(h("p", { className: "empty", textContent: "Nessun messaggio ancora: fai una prenotazione dal sito." }));
  $("[data-outbox]").replaceChildren(...groups.map(({ code, jobs }) => {
    const booking = snapshot.bookings.find((b) => b.code === code);
    const title = booking ? `${code} · ${booking.guest.name} · ${fmtDate(booking.checkIn)} → ${fmtDate(booking.checkOut)}` : code;
    return h("section", { className: "thread-box" }, h("h3", { className: "thread-box__title mono", textContent: title }),
      ...jobs.map((j) => h("article", { className: `bubble bubble--${j.audience}${j.status === "cancelled" ? " is-cancelled" : ""}` },
        h("p", { className: "bubble__meta mono", textContent: `${KIND_LABEL[j.kind] ?? j.kind} · ${j.audience === "host" ? "al gestore" : "all'ospite"} · ${dateTime.format(Date.parse(j.status === "sent" && j.sentAt ? j.sentAt : j.sendAt))}` }),
        h("p", { className: "bubble__text", textContent: j.text }),
        h("span", { className: `bubble__status bubble__status--${j.status}`, textContent: STATUS_LABEL[j.status] ?? j.status, title: j.error ?? "" }))));
  }));
}

// ---------- planning and bookings
function renderPlan(active) {
  const { today } = snapshot;
  const end = addDays(today, PLAN_DAYS);
  const days = Array.from({ length: PLAN_DAYS }, (_, i) => addDays(today, i));
  const weekend = (iso) => [0, 6].includes(parseISO(iso).getUTCDay());
  const grid = h("div", { className: "plan__grid", style: { "--days": String(PLAN_DAYS) } });
  grid.append(h("div", { className: "plan__corner", textContent: "Camera" }));
  days.forEach((iso) =>
    grid.append(h("div", { className: `plan__day${weekend(iso) ? " is-weekend" : ""}${iso === today ? " is-today" : ""}` },
      fmtDate(iso, { weekday: "short" }), h("b", { textContent: String(Number(iso.slice(8))) }))),
  );
  ROOMS.forEach((room, r) => {
    const row = r + 2;
    grid.append(h("div", { className: "plan__room", style: { ...roomVars(room), "grid-row": String(row), "grid-column": "1" } }, h("i"), room.name));
    days.forEach((iso, i) => grid.append(h("div", { className: `plan__cell${weekend(iso) ? " is-weekend" : ""}`, style: { "grid-row": String(row), "grid-column": String(i + 2) } })));
    active.filter((b) => b.roomId === room.id && b.checkIn < end && b.checkOut > today).forEach((b) => {
      const start = b.checkIn < today ? today : b.checkIn;
      const stop = b.checkOut > end ? end : b.checkOut;
      const variant = b.conflict ? " plan__bar--conflict" : b.channel === CHANNEL_BOOKING ? " plan__bar--ota" : isDirect(b) ? " plan__bar--web" : "";
      const span = nightsBetween(start, stop);
      const short = span < 2; // one night = one narrow cell: initials and channel code, details in the tooltip
      const label = `${b.guest.name} · ${b.channel} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}${b.conflict ? " · DOPPIA PRENOTAZIONE" : ""}`;
      grid.append(h("div", {
        className: `plan__bar${variant}${short ? " plan__bar--short" : ""}`, title: label, ariaLabel: label,
        style: { ...roomVars(room), "grid-row": String(row), "grid-column": `${nightsBetween(today, start) + 2} / span ${span}` },
      }, h("span", { textContent: short ? initials(b.guest.name) : b.guest.name }), h("small", { textContent: span < 3 ? CHANNEL_CODE[b.channel] ?? "" : b.channel })));
    });
  });
  $("[data-plan]").replaceChildren(grid);
}

function renderTable() {
  const { today, bookings } = snapshot;
  const soon = addDays(today, UPCOMING_DAYS);
  const rows = bookings.filter((b) => isDirect(b) || b.conflict || (b.checkOut >= today && b.checkIn < soon)).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  if (!rows.length) return $("[data-table]").replaceChildren(h("p", { className: "empty", textContent: "Nessuna prenotazione in arrivo." }));
  const head = h("tr", {}, ...["Codice", "Ospite", "Camera", "Arrivo", "Partenza", "Notti", "Totale", "Canale", ""].map((t) => h("th", { scope: "col", textContent: t })));
  const body = rows.map((b) => {
    const room = roomById(b.roomId);
    const cancelled = b.status === "annullata";
    const action = cancelled ? h("span", { className: "badge", textContent: "Annullata" })
      : b.channel !== CHANNEL_BOOKING ? h("button", { className: "link-btn", type: "button", textContent: "Annulla", onclick: () => onCancel(b) })
      : h("span", { className: "badge", textContent: b.conflict ? "Doppia prenotazione" : "Confermata" });
    return h("tr", { className: cancelled ? "is-cancelled" : "" },
      h("td", { textContent: b.code }),
      h("td", { textContent: b.guest.name }),
      h("td", {}, h("span", { className: "swatch", style: roomVars(room) }), room.name),
      h("td", { textContent: fmtDate(b.checkIn) }),
      h("td", { textContent: fmtDate(b.checkOut) }),
      h("td", { textContent: String(b.nights) }),
      h("td", { textContent: `${b.estimated ? "~" : ""}${fmtEuro(b.total)}` }),
      h("td", {}, h("span", { className: `badge${isDirect(b) ? " badge--web" : ""}`, textContent: b.channel })),
      h("td", {}, action));
  });
  $("[data-table]").replaceChildren(h("table", { className: "table" }, h("thead", {}, head), h("tbody", {}, ...body)));
}

function onCancel(b) {
  if (!confirm(`Annullare la prenotazione ${b.code} di ${b.guest.name}? I messaggi programmati all'ospite vengono annullati.`)) return;
  act(() => cancelBooking(b.code), `Prenotazione ${b.code} annullata: le date tornano libere anche per i portali.`);
}

$("[data-reset]").addEventListener("click", () => {
  if (!confirm("Ripristinare la demo? Le prenotazioni fatte dal sito e i messaggi vengono cancellati.")) return;
  act(() => adminPost("demo/reset"), "Demo ripristinata.");
});

setInterval(() => document.hidden || load(), REFRESH_MS);
load();
