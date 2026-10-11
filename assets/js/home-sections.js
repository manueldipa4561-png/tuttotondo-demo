// Sections of the home page that are drawn from data.js, so numbers and room details live in one place.
import { IMAGES, PROPERTY, ROOMS, REVIEWS } from "./data.js";
import { addDays, fmtEuro, quote, todayISO } from "./store.js";
import { $, h } from "./dom.js";

const FACT_TONES = ["#efc9be", "#c9d1bd", "#f6d2a8", "#e8a98f"];
const RING_TONES = ["#c8613a", "#f0b070", "#9ca58f", "#e3a999", "#a4472a", "#566049", "#d98f3f", "#17140f"];
const QUOTE_TONES = ["#efc9be", "#c9d1bd", "#f6d2a8", "#e8a98f", "#dfe4d4"];
const RATING_ORDER = ["location", "couples", "cleanliness", "wifi", "comfort", "staff", "facilities", "value"];
const RING_RADIUS = 190;
const RING_STEP = 19;
const SVG_NS = "http://www.w3.org/2000/svg";

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
};

// ctx = { t(key, vars), lang, locale }
export function renderSections(ctx) {
  renderFacts(ctx);
  renderRooms(ctx);
  renderReviews(ctx);
  renderInfo(ctx);
}

function renderFacts({ t, locale }) {
  const score = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).format(PROPERTY.ratings.location);
  const facts = [
    [`${PROPERTY.near.beachWalkMin} min`, t("factBeach")],
    [`${PROPERTY.near.stationM} m`, t("factStation")],
    [score, t("factLocation")],
    [PROPERTY.checkInTo, t("factCheckin")],
  ];
  $("[data-facts]").replaceChildren(...facts.map(([value, label], i) =>
    h("li", { className: "fact", style: { "--tone": FACT_TONES[i], "--n": String(i) } }, h("b", { textContent: value }), h("span", { textContent: label }))));
}

function renderRooms({ t, lang }) {
  const from = todayISO();
  const nextDay = addDays(from, 1);
  $("[data-rooms]").replaceChildren(...ROOMS.map((room) => {
    const q = quote(room, from, nextDay); // one night: direct price against the estimated portal price
    const [width, height] = IMAGES[room.images[0]];
    const copy = lang === "en" ? room.en : room;
    return h("li", { className: "room", style: { "--room": room.color, "--crop-x": room.crop.x, "--crop-y": room.crop.y, "--crop-zoom": String(room.crop.zoom) } },
      h("div", { className: "room__media" },
        h("div", { className: "room__disc" },
          h("img", { src: `assets/img/${room.images[0]}-1600.jpg`, width, height, loading: "lazy", decoding: "async", alt: t("roomImgAlt", { room: room.name }) })),
        h("span", { className: "room__badge", attrs: { "aria-hidden": "true" } }, String(room.guests), h("small", { textContent: lang === "en" ? "guests" : "ospiti" }))),
      h("h3", { className: "room__name", textContent: room.name }),
      h("p", { className: "room__type", textContent: `${copy.type} · ${copy.bed}` }),
      h("p", { className: "room__blurb", textContent: copy.blurb }),
      h("p", { className: "room__price" },
        h("b", { textContent: fmtEuro(q.rate) }), ` ${t("perNight")} ${t("roomDirect")} · `, h("s", { textContent: `~${fmtEuro(q.portal)}` }), ` ${t("roomPortal")}`),
      h("a", { className: "btn room__go", href: `prenota.html?camera=${room.id}&adulti=${room.guests}&lang=${lang}` },
        h("span", { textContent: t("roomBook") }), " ", h("span", { textContent: "→", attrs: { "aria-hidden": "true" } })));
  }));
}

function renderReviews({ t, lang, locale }) {
  const score = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 });
  const count = new Intl.NumberFormat(locale).format(PROPERTY.ratings.count);
  const rings = RATING_ORDER.map((key, i) => ({ key, value: PROPERTY.ratings[key], tone: RING_TONES[i], n: i }));

  const chart = svg("svg", { viewBox: "0 0 400 400", "aria-hidden": "true", focusable: "false" });
  rings.forEach(({ value, tone, n }) => {
    const r = String(RING_RADIUS - n * RING_STEP);
    const common = { cx: "200", cy: "200", r, pathLength: "100" };
    const track = svg("circle", { ...common, class: "ring ring--track" });
    const fill = svg("circle", { ...common, class: "ring ring--fill" });
    fill.style.cssText = `--score:${value};--n:${n};--tone:${tone}`;
    chart.append(track, fill);
  });
  const center = h("div", { className: "rings__center" }, h("b", { textContent: score.format(PROPERTY.ratings.overall) }));
  const caption = h("p", { className: "rings__caption mono", textContent: `${t("ratingOverall")} · ${t("ratingCount", { n: count })}` });
  const legend = h("ul", { className: "rings__legend" }, ...rings.map(({ key, value, tone }) =>
    h("li", { style: { "--tone": tone } }, h("i"), t(`rating${key[0].toUpperCase()}${key.slice(1)}`), h("b", { textContent: score.format(value) }))));
  $("[data-rings]").replaceChildren(h("div", { className: "rings__chart" }, chart, center), caption, legend);

  $("[data-quotes]").replaceChildren(...REVIEWS.map((review, i) =>
    h("li", { className: "quote", style: { "--tone": QUOTE_TONES[i % QUOTE_TONES.length] } },
      h("p", { textContent: `“${review.text}”`, lang: "en" }),
      h("footer", { textContent: t("quoteBy", { who: review.who, from: t(`country${review.from.replaceAll(" ", "")}`) }) }))));
  $("[data-rev-note]").textContent = t("revNote");
}

function renderInfo({ t, locale }) {
  const money = new Intl.NumberFormat(locale, { minimumFractionDigits: 2 });
  const chip = (text) => h("li", { className: "chip", textContent: text });
  $("[data-chips]").replaceChildren(...[
    t("chipCheckin", { from: PROPERTY.checkInFrom, to: PROPERTY.checkInTo }), t("chipCheckout", { t: PROPERTY.checkOutBy }),
    t("chipWifi"), t("chipAc"), t("chipCrib", { eur: PROPERTY.cribPerNight }), t("chipNoPets"), t("chipNoSmoke"), t("chipNoParty"), t("chipCash"), t("chipCancel"),
  ].map(chip));
  const { near } = PROPERTY;
  $("[data-near]").replaceChildren(...[
    t("nearStation", { n: near.stationM }), t("nearBeach", { n: near.beachWalkMin }), t("nearMuseum"),
    t("nearAirport", { n: near.airportKm }), t("nearParking", { m: near.parkingM, p: money.format(near.parkingPerDay) }),
  ].map(chip));
  document.querySelectorAll("[data-address]").forEach((el) => (el.textContent = `${PROPERTY.address}, ${PROPERTY.postcode} ${PROPERTY.city}`));
  $("[data-cin]").textContent = `CIN ${PROPERTY.cin}`;
  $("[data-maps]").href = PROPERTY.mapsUrl;
}
