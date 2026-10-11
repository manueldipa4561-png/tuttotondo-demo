// Behaviour shared by every page: nav, mobile menu, contact and WhatsApp links. No animation library: all motion
// lives in CSS (home-motion.css), this file only toggles classes and sets a variable when the browser has no scroll timelines.
import { PROPERTY } from "./data.js";

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const hasScrollTimelines = CSS.supports("animation-timeline: scroll()");

// ---------- WhatsApp: a ready-made message with room, dates and guests
const WA_TEXT = {
  it: { base: `Ciao, vorrei prenotare da ${PROPERTY.name}`, room: " la camera {room}", dates: " dal {in} al {out}", guests: " per {n} {w}", ask: ". È disponibile? Grazie!", askAny: ". Potete dirmi la disponibilità? Grazie!", one: "persona", many: "persone" },
  en: { base: `Hi, I'd like to book at ${PROPERTY.name}`, room: " the {room} room", dates: " from {in} to {out}", guests: " for {n} {w}", ask: ". Is it available? Thank you!", askAny: ". Could you tell me what's available? Thank you!", one: "guest", many: "guests" },
};
const waDate = (iso) => iso.split("-").reverse().join("/"); // 2026-11-15 → 15/11/2026
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

export function whatsappUrl({ room, arrivo, partenza, adulti, lang = "it" } = {}) {
  const t = WA_TEXT[lang] ?? WA_TEXT.it;
  const n = Number(adulti);
  let text = t.base;
  if (room) text += fill(t.room, { room });
  if (arrivo && partenza) text += fill(t.dates, { in: waDate(arrivo), out: waDate(partenza) });
  if (n >= 1) text += fill(t.guests, { n, w: n === 1 ? t.one : t.many });
  text += arrivo && partenza ? t.ask : t.askAny;
  return `https://wa.me/${PROPERTY.whatsapp}?text=${encodeURIComponent(text)}`;
}

// Every [data-wa] is a "book now" button: the static href (booking page) stays as the fallback without JS
export function fillWhatsApp(lang) {
  document.querySelectorAll("[data-wa]").forEach((el) => {
    el.href = whatsappUrl({ room: el.dataset.waRoom, lang: lang ?? el.dataset.waLang });
    Object.assign(el, { target: "_blank", rel: "noopener" });
  });
}

// Every [data-contact="phone|whatsapp|email"] becomes a real link, with the details from data.js
function fillContacts() {
  const links = {
    phone: { href: `tel:${PROPERTY.phone.replace(/\s/g, "")}`, text: PROPERTY.phone },
    whatsapp: { href: `https://wa.me/${PROPERTY.whatsapp}`, text: "WhatsApp" },
    email: { href: `mailto:${PROPERTY.email}`, text: PROPERTY.email },
  };
  document.querySelectorAll("[data-contact]").forEach((el) => {
    const link = links[el.dataset.contact];
    if (!link) return;
    el.href = link.href;
    if (!el.dataset.keepText) el.textContent = link.text;
    if (el.dataset.contact === "whatsapp") Object.assign(el, { target: "_blank", rel: "noopener" });
  });
}

const HIDE_NAV_AFTER = 480;

export function initSite() {
  fillContacts();
  fillWhatsApp();
  initNav();
  initMenu();
}

function initNav() {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;
  const progress = hasScrollTimelines ? null : document.querySelector("[data-progress]"); // with timelines CSS draws it
  let lastY = 0;
  let ticking = false;
  const update = () => {
    const y = scrollY;
    nav.classList.toggle("is-hidden", y > HIDE_NAV_AFTER && y > lastY && !document.body.classList.contains("menu-open"));
    if (progress) {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
    }
    lastY = y;
    ticking = false;
  };
  addEventListener("scroll", () => {
    if (!ticking) requestAnimationFrame(update);
    ticking = true;
  }, { passive: true });
  update();
}

function initMenu() {
  const button = document.querySelector(".nav__burger");
  const menu = document.getElementById("menu");
  if (!button || !menu) return;
  const setOpen = (open) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? button.dataset.close : button.dataset.open;
    document.body.classList.toggle("menu-open", open);
  };
  button.addEventListener("click", () => setOpen(menu.hidden));
  menu.addEventListener("click", (e) => e.target.closest("a") && setOpen(false));
  addEventListener("keydown", (e) => e.key === "Escape" && !menu.hidden && (setOpen(false), button.focus()));
}
