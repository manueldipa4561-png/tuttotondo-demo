// Comportamenti comuni a tutte le pagine: smooth scroll, nav, menu mobile, ancore, cursore, contatti.
import { PROPERTY } from "./data.js";

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- WhatsApp: messaggio già scritto con camera, date e ospiti
const WA_TEXT = {
  it: { base: "Ciao, vorrei prenotare da Borghese", room: " la camera {room}", dates: " dal {in} al {out}", guests: " per {n} {w}", ask: ". È disponibile? Grazie!", askAny: ". Potete dirmi la disponibilità? Grazie!", one: "persona", many: "persone" },
  en: { base: "Hi, I'd like to book at Borghese", room: " the {room} room", dates: " from {in} to {out}", guests: " for {n} {w}", ask: ". Is it available? Thank you!", askAny: ". Could you tell me what's available? Thank you!", one: "guest", many: "guests" },
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

// Ogni [data-wa] è un pulsante "Prenota subito": l'href statico (pagina di prenotazione) resta come ripiego senza JS
function fillWhatsApp() {
  document.querySelectorAll("[data-wa]").forEach((el) => {
    el.href = whatsappUrl({ room: el.dataset.waRoom, lang: el.dataset.waLang });
    Object.assign(el, { target: "_blank", rel: "noopener" });
  });
}

// Ogni [data-contact="phone|whatsapp|email"] diventa un link vero, dati presi da data.js
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

const SCROLLED_AT = 40;
const HIDE_NAV_AFTER = 480;

export function initSite() {
  const { gsap, ScrollTrigger, Lenis } = window;
  if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  let lenis = null;
  if (!reducedMotion && Lenis) {
    lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
    if (gsap && ScrollTrigger) {
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }

  fillContacts();
  fillWhatsApp();
  initNav();
  initMenu(lenis);
  initAnchors(lenis);
  initCursor(gsap);
  return { lenis };
}

function initNav() {
  const nav = document.querySelector("[data-nav]");
  const progress = document.querySelector("[data-progress]");
  const bookBar = document.querySelector(".mobile-book");
  if (!nav) return;
  let lastY = 0;
  let ticking = false;
  const update = () => {
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    nav.classList.toggle("is-scrolled", y > SCROLLED_AT);
    nav.classList.toggle("is-hidden", y > HIDE_NAV_AFTER && y > lastY && !document.body.classList.contains("menu-open"));
    progress?.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
    bookBar?.classList.toggle("is-visible", y < max - innerHeight * 1.2); // sparisce solo vicino alla CTA finale
    lastY = y;
    ticking = false;
  };
  addEventListener("scroll", () => {
    if (!ticking) requestAnimationFrame(update);
    ticking = true;
  }, { passive: true });
  update();
}

function initMenu(lenis) {
  const button = document.querySelector(".nav__burger");
  const menu = document.getElementById("menu");
  if (!button || !menu) return;
  const setOpen = (open) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Chiudi" : "Menu";
    document.body.classList.toggle("menu-open", open);
    open ? lenis?.stop() : lenis?.start();
  };
  button.addEventListener("click", () => setOpen(menu.hidden));
  menu.addEventListener("click", (e) => e.target.closest("a") && setOpen(false));
  addEventListener("keydown", (e) => e.key === "Escape" && !menu.hidden && (setOpen(false), button.focus()));
}

function initAnchors(lenis) {
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    e.preventDefault();
    const offset = -parseInt(getComputedStyle(document.documentElement).getPropertyValue("--nav-h"), 10) || 0;
    if (lenis) lenis.scrollTo(target, { offset, duration: 1.4 });
    else target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
    // preventDefault annulla lo spostamento nativo del focus: lo rifacciamo a mano
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });
}

function initCursor(gsap) {
  const cursor = document.querySelector(".cursor");
  if (!cursor || !gsap || reducedMotion || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const label = cursor.querySelector(".cursor__label");
  const toX = gsap.quickTo(cursor, "x", { duration: 0.45, ease: "power3" });
  const toY = gsap.quickTo(cursor, "y", { duration: 0.45, ease: "power3" });
  addEventListener("pointermove", (e) => {
    cursor.classList.add("is-on");
    toX(e.clientX);
    toY(e.clientY);
  });
  document.addEventListener("pointerleave", () => cursor.classList.remove("is-on"));
  document.addEventListener("pointerover", (e) => {
    const target = e.target.closest("[data-cursor]");
    cursor.classList.toggle("is-label", Boolean(target));
    if (target) label.textContent = target.dataset.cursor;
  });
}
