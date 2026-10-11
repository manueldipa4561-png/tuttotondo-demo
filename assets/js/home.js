// Home page entry: language (IT default, EN toggle), the hero booking bar, and the sections drawn from data.js.
// The scroll scenes themselves are pure CSS (home-motion.css); home-motion.js only measures a few things for them.
import { initSite, fillWhatsApp } from "./site.js";
import { MAX_GUESTS, addDays, ready, todayISO } from "./store.js";
import { STRINGS } from "./home-i18n.js";
import { $, $$, fill, h } from "./dom.js";
import { renderSections } from "./home-sections.js";
import { initCompare } from "./home-compare.js";
import { initMotion } from "./home-motion.js";

const LANG_KEY = "tuttotondo.lang"; // shared with the booking page
const DEFAULT_ARRIVAL_IN_DAYS = 14;
const DEFAULT_NIGHTS = 2;

// ---------- language
const params = new URLSearchParams(location.search);
let lang = (() => {
  const asked = params.get("lang");
  if (asked === "en" || asked === "it") return asked;
  try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "it"; } catch { return "it"; } // preference is optional
})();

const t = (key, vars) => fill(STRINGS[lang][key] ?? STRINGS.it[key] ?? key, vars);
const locale = () => (lang === "en" ? "en-GB" : "it-IT");
const ctx = () => ({ t, lang, locale: locale() });

// Every static string has its Italian in the HTML: it is read once, kept, and put back when the visitor returns to Italian.
const SLOTS = [
  ["data-i18n", (el, value) => (el.textContent = value), (el) => el.textContent],
  ["data-i18n-html", (el, value) => (el.innerHTML = value), (el) => el.innerHTML], // only our own dictionary text
  ["data-i18n-alt", (el, value) => el.setAttribute("alt", value), (el) => el.getAttribute("alt")],
  ["data-i18n-aria", (el, value) => el.setAttribute("aria-label", value), (el) => el.getAttribute("aria-label")],
];
const italian = new WeakMap();

function applyStatic() {
  document.documentElement.lang = lang;
  document.title = t("pageTitle");
  for (const [attr, write, read] of SLOTS) {
    $$(`[${attr}]`).forEach((el) => {
      const saved = italian.get(el) ?? {};
      saved[attr] ??= read(el);
      italian.set(el, saved);
      write(el, lang === "it" ? saved[attr] : STRINGS.en[el.getAttribute(attr)] ?? saved[attr]);
    });
  }
  const toggle = $("[data-lang-toggle]");
  toggle.textContent = t("langSwitch");
  toggle.lang = lang === "en" ? "it" : "en";
  const burger = $(".nav__burger");
  burger.dataset.close = lang === "en" ? "Close" : "Chiudi";
  if (burger.getAttribute("aria-expanded") === "true") burger.textContent = burger.dataset.close;
  $$("[data-book-link]").forEach((a) => (a.href = `prenota.html?lang=${lang}`));
  $("[data-lang-field]").value = lang;
  fillWhatsApp(lang);
}

// ---------- hero booking bar: native date inputs, submits to the booking page as ?arrivo=&partenza=&adulti=&lang=
async function initQuickBar() {
  const arrival = $("#q-in");
  const departure = $("#q-out");
  const guests = $("[data-guests]");
  guests.replaceChildren(...Array.from({ length: MAX_GUESTS }, (_, i) => h("option", { value: String(i + 1), textContent: String(i + 1), selected: i + 1 === 2 })));
  await ready; // the server's "today" (the demo clock can move it)
  const today = todayISO();
  arrival.min = today;
  arrival.value ||= addDays(today, DEFAULT_ARRIVAL_IN_DAYS);
  departure.min = addDays(arrival.value, 1);
  departure.value ||= addDays(arrival.value, DEFAULT_NIGHTS);
  arrival.addEventListener("change", () => {
    if (!arrival.value) return;
    departure.min = addDays(arrival.value, 1);
    if (departure.value < departure.min) departure.value = departure.min;
  });
}

// the round "Prenota" button (and, on narrow screens, the owner-panel pill) appears once the hero is behind you and goes away
// at the final call to action: in the hero the pill would sit on top of the booking bar
function initMobileBook() {
  const bar = $("[data-mobile-book]");
  const ownerTab = $(".owner-tab");
  const covering = new Set();
  const watch = new IntersectionObserver((entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? covering.add(entry.target) : covering.delete(entry.target)));
    bar.classList.toggle("is-visible", covering.size === 0);
    ownerTab?.classList.toggle("is-visible", covering.size === 0);
  });
  watch.observe($(".hero"));
  watch.observe($("[data-final]"));
}

initSite();
const refreshCompare = initCompare();
function render() {
  applyStatic();
  renderSections(ctx());
  refreshCompare(ctx());
}

$("[data-lang-toggle]").addEventListener("click", () => {
  lang = lang === "en" ? "it" : "en";
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* preference not saved: the language stays for this visit */ }
  const url = new URL(location.href);
  url.searchParams.set("lang", lang);
  history.replaceState(null, "", url);
  render();
});

render();
initMotion();
initMobileBook();
initQuickBar();
