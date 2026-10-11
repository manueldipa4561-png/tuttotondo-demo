// The little JavaScript the scroll scenes need. The motion itself is CSS (home-motion.css); this file only
// (1) measures the layout once so the CSS scenes line up, and (2) reveals sections in browsers without scroll timelines.
import { $, $$ } from "./dom.js";

const O_CENTRE_ABOVE_BASELINE = 0.27; // the middle of a lowercase "o" sits about this many em above the baseline
const O_RADIUS = 0.25; // em: the circle starts as big as the "o" itself
const CHAT_PADDING_PX = 16; // the chat's own top and bottom padding (12 + 4)
const REVEAL = ".sec-head > *, .fact, .room__disc, .room__name, .gallery__disc, .gallery__item p, .quote, .steps4 li, .vs__panel, .final__disc, .walk__step, .msg, .info__col, .faq";
const root = document.documentElement;
const motionOff = () => root.classList.contains("calm");

// ---------- hero: the photo circle grows out of the "o" of "tondo", wherever the font puts it
function placeHeroCircle() {
  const stage = $("[data-hero]");
  const o = $("[data-portal]", stage);
  const base = $(".hero__base", o);
  const place = () => {
    const box = stage.getBoundingClientRect();
    const glyph = o.getBoundingClientRect();
    const size = parseFloat(getComputedStyle(o).fontSize);
    const cx = glyph.left + glyph.width / 2 - box.left;
    const cy = base.getBoundingClientRect().bottom - O_CENTRE_ABOVE_BASELINE * size - box.top;
    stage.style.setProperty("--cx", `${cx.toFixed(1)}px`);
    stage.style.setProperty("--cy", `${cy.toFixed(1)}px`);
    stage.style.setProperty("--r0", `${(O_RADIUS * size).toFixed(1)}px`);
    // just enough radius to reach the farthest corner, so the circle finishes exactly when the scroll range does
    stage.style.setProperty("--r1", `${Math.hypot(Math.max(cx, box.width - cx), Math.max(cy, box.height - cy)).toFixed(0)}px`);
  };
  document.fonts.ready.then(place);
  new ResizeObserver(place).observe(stage);
  place();
}

// ---------- walkthrough: how far the chat must slide up after each message so the newest one sits at the bottom
function measureChat() {
  const chat = $("[data-chat]");
  const list = $(".chat__list", chat);
  const measure = () => {
    [...list.children].forEach((msg, i) => {
      const bottom = msg.offsetTop + msg.offsetHeight + CHAT_PADDING_PX; // layout values: unaffected by the reveal transforms
      list.style.setProperty(`--y${i}`, `${Math.max(0, bottom - chat.clientHeight)}px`);
    });
    // a running scroll animation keeps the keyframe values it started with: restart it so it picks up the new ones
    list.style.animationName = "none";
    void list.offsetWidth;
    list.style.animationName = "";
  };
  new ResizeObserver(measure).observe(chat);
  new ResizeObserver(measure).observe(list);
  measure();
}

// ---------- no scroll timelines (Firefox for now): one-shot reveals instead of scrubbed scenes
function revealOnView() {
  const seen = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("is-in");
    seen.unobserve(entry.target);
  }), { threshold: 0.2 });
  $$(REVEAL).forEach((el) => {
    el.setAttribute("data-reveal", "");
    seen.observe(el);
  });
  seen.observe($("[data-rings]"));
  requestAnimationFrame(() => $(".hero").classList.add("is-open"));
}

export function initMotion() {
  placeHeroCircle();
  measureChat();
  if (root.classList.contains("no-sda") && !motionOff()) revealOnView();
}
