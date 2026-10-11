// Direct vs portal: two circles whose AREA follows the price (so the radius follows its square root). All numbers come
// from the shared engine's quote(), the same one the booking page uses; nothing here is invented.
import { ROOMS, roomById } from "./data.js";
import { DIRECT_DISCOUNT, OTA_COMMISSION, addDays, fmtEuro, quote, todayISO } from "./store.js";
import { $, h } from "./dom.js";

const DEFAULT_ROOM = "large";

// The circles are scaled against the dearest possible choice (top room, longest stay), so they grow and shrink as you move the controls.
const referencePortal = (maxNights) => {
  const from = todayISO();
  return Math.max(...ROOMS.map((room) => quote(room, from, addDays(from, maxNights)).portal));
};

export function initCompare() {
  const root = $("[data-vs]");
  const select = $("[data-vs-room]", root);
  const range = $("[data-vs-nights]", root);
  const out = $("[data-vs-nights-out]", root);
  let ctx = null;

  function render() {
    const from = todayISO();
    const room = roomById(select.value);
    const nights = Number(range.value);
    const q = quote(room, from, addDays(from, nights));
    const max = referencePortal(Number(range.max));
    const chart = $(".vs__chart", root);
    chart.style.setProperty("--sp", Math.sqrt(q.portal / max).toFixed(3));
    chart.style.setProperty("--sd", Math.sqrt(q.total / max).toFixed(3));
    out.textContent = String(nights);
    $("[data-vs-portal]", root).textContent = fmtEuro(q.portal);
    $("[data-vs-direct]", root).textContent = fmtEuro(q.total);
    $("[data-vs-save]", root).textContent = fmtEuro(q.saving);
    document.querySelector("[data-vs-note]").textContent = ctx.t("vsNote", {
      discount: Math.round(DIRECT_DISCOUNT * 100), commission: Math.round(OTA_COMMISSION * 100), amount: fmtEuro(Math.round(q.total * OTA_COMMISSION)),
    });
  }

  select.addEventListener("change", render);
  range.addEventListener("input", render);

  // called again whenever the language changes: option labels and the note are translated, the choice stays
  return (nextCtx) => {
    ctx = nextCtx;
    const chosen = select.value || DEFAULT_ROOM;
    select.replaceChildren(...ROOMS.map((room) => h("option", { value: room.id, textContent: `${room.name} · ${ctx.lang === "en" ? room.en.type : room.type}` })));
    select.value = chosen;
    render();
  };
}
