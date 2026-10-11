# Tuttotondo (Pescara): direct-booking demo

Demo site for **Tuttotondo**, a five-room guest house in Corso Vittorio Emanuele II 129, Pescara. It sells rooms directly
(no commissions), keeps the calendar in sync with Booking.com through iCal, and runs the whole arrival over WhatsApp,
because there is no reception: **the reception lives in the guest's phone.**

Everything is local. The server binds to `127.0.0.1` only, nothing is deployed, nothing is sent to the internet
(WhatsApp messages are written to an outbox unless Meta credentials exist).

## Run

```sh
npm start        # http://localhost:4129/
node --test      # 62 tests
```

Zero dependencies, Node 22+ (developed on 24). Pages:

| URL | What |
| --- | --- |
| `/` | Home: scroll-driven story, rooms, price comparison, reviews, info |
| `/prenota.html` | Booking flow (IT/EN), availability from the local API |
| `/gestione.html` | Host console: KPIs, channel sync, Booking.com simulator, WhatsApp outbox with demo clock, planning board |

## Static hosting (Netlify, GitHub Pages)

The pages also work on a host that only serves files. When a page finds no API (the first request to `/api/availability` is not answered in JSON), `assets/js/store.js` loads `assets/js/demo-backend.js`, which answers the same routes inside the browser with the same booking core. The data lives in the visitor's `localStorage` and starts from a fresh seed every day; the manager panel says "demo nel browser". Nothing leaves the browser and no WhatsApp message is sent. This is for showing the demo: real bookings need the Node server.

## Structure

- `server/`: the Node side. `app.mjs` is the HTTP server and the static pages, `db.mjs` the JSON-file database, `index.mjs` the entry point and timers.
- `assets/js/api/`: the booking API with no Node in it. `core.js` has the routes, then iCal export/import, mock Booking.com, WhatsApp scheduler and seed data. `templates.js` holds the message texts, `whatsapp.js` the schedule and the demo door code. The Node server and the in-browser demo backend (`assets/js/demo-backend.js`) both run this same code.
- `assets/js/engine.js`: pure booking rules shared by browser and server (seat-based availability, prices, validation).
- `assets/js/data.js`: the property, the five rooms, ratings, quotes. One place to edit content.
- `assets/js/home*.js`, `assets/css/home.css`, `home-motion.css`: the home page. `home-i18n.js` has the English; the Italian lives in `index.html`.
- `assets/css/base.css`: the theme (tokens, type, buttons, nav, footer). `booking.css` and `admin.css` use the same tokens.
- `tests/`: engine, API, iCal, channel sync, WhatsApp, and the home copy.

## Design concept: "tutto tondo" (all round)

Circles and semicircles everywhere: pill buttons, round image masks, round badges, ring charts, a floating capsule nav. The
palette comes from the real rooms (blush walls, sage arched headboards, terracotta throw, coral wall lamps).
Type: **Bricolage Grotesque** for display (characterful, heavy, round counters; a variable font with an optical-size axis) and
**Figtree** for body. No serif, on purpose.

Scenes, all native CSS scroll-driven animations (no GSAP, no Lenis, no library):

1. **Hero**: the photo circle grows out of the "o" of "tondo" (clip-path, pinned stage); an orbiting text badge spins with the scroll; a quick-book bar submits to `prenota.html?arrivo=&partenza=&adulti=&lang=`.
2. **Walkthrough**: a pinned phone plays the guest's WhatsApp conversation (confirmation, instructions with the door code, "I'm here", "your room is ready", thanks and review) while a ring fills.
3. **Rooms**: five round tokens, each linking to `prenota.html?camera=<id>&adulti=<n>`, with direct price against the estimated portal price from the engine's `quote()`.
4. **Direct vs portal**: two nested circles whose area follows the price, with a room and nights selector.
5. **Reviews**: concentric ring chart (`stroke-dashoffset`) and the guests' own words.
6. **Info**: self check-in explained, times and rules, location, FAQ with native `<details>`.

Motion rules: only `transform`, `opacity` and `clip-path` move (plus the dash offset of a few small SVG arcs). Browsers without scroll
timelines (Firefox for now) get one-shot reveals through IntersectionObserver; `prefers-reduced-motion` gets the end state.

## What is simulated

- Booking.com: a mock channel that re-reads our calendar only every few minutes, so double bookings can happen and are flagged. Real life: Booking.com "Sync calendars" iCal links, which are pulled about every 1–4 hours (not instant).
- WhatsApp: dry-run outbox. Real sending needs the Cloud API credentials in `.env` (see `.env.example`) and Meta-approved utility templates (texts from `metaText()` in `assets/js/api/whatsapp.js`), plus the guest's opt-in (the booking page asks for it).
- **Door code (DEMO):** a 4-digit number derived from the booking code (`accessCode()` in `assets/js/api/whatsapp.js`, a stable string hash). It exists to show the idea. Real life: the smart-lock API issues a code valid from check-in to check-out.
- Payments: none online (pay at the property or by bank transfer), cancellation 48 h free is a demo proposal.
- Photos: the **real photos from the public Booking.com listing**, used for the demo and credited on the page (hero caption, footer). They are native size (845–1600 px wide, never upscaled; the hero uses the largest size the listing serves, 1600×1200, with a fine grain on phones), so the hero stops growing as a full-bleed image on very wide screens. **The listing does not say which photo shows which room**, so the room-to-photo mapping is a placeholder (Double Bath: `bedroom-arch`, Double: `bedroom-pink`, Large Double: `bedroom-towels`, Standard Double: `bedroom-window`, Triple: `dining-corner`; `kitchenette` and `corridor` appear in "Inside Tuttotondo"). Change it in `assets/js/data.js`.

## Owner checklist (every demo value to confirm)

- [ ] Contacts: phone `+39 000 000 0000`, WhatsApp `390000000000`, email `info@esempio.it` are **placeholders** (`PROPERTY` in `assets/js/data.js`).
- [ ] Rates, one room per type, capacities (2, 2, 2, 2, 3): demo values between 55 and 85 EUR a night.
- [ ] Direct discount of 10% under the portals and the 15% portal commission: proposals.
- [ ] Free cancellation up to 48 h; payment at the property or by transfer; how cash is collected when nobody is at a desk.
- [ ] The real entry procedure (door code, key box, smart lock) and what the arrival texts say; the demo code is not a real one.
- [ ] Booking.com score 8.2 and 637 reviews come from a site that mirrors Booking.com: verify on the live listing. Category scores (location 9.0, cleanliness 8.7, Wi-Fi 8.7, comfort 8.5, staff 8.5, facilities 8.3, value 8.2, couples 8.9) were read on the listing in October 2026.
- [ ] **Photos:** they come from the public Booking.com listing. Get the owner's permission or replace them with official photos, and say which photo shows which room (the mapping in `data.js` is a placeholder).
- [ ] Permission to show the five guest quotes (Booking.com guests, shown verbatim, original English).
- [ ] Booking.com and review links (`listingUrl`, `reviewsUrl`): the exact listing page was not found, so they are searches.
- [ ] Car park about 300 m away at about 2.50 EUR a day: from one Tripadvisor review.
- [ ] Which rooms have a terrace or balcony, kitchenette, minibar, city view; where the coffee machine is (corridor, rooms); which rooms lack a kettle.
- [ ] Crib 15 EUR per child per night (ages 0–3), no extra beds; age bands used on the booking page (children 4–12).
- [ ] City tourist tax wording; CIN `IT068028B4HICAJULU`.
- [ ] Opening the host console: it has no login. Keep it local, or set `ALLOW_REMOTE=1` with `ADMIN_TOKEN`.

## Sources (October 2026)

Public Booking.com listing (room types, amenities, scores, guest quotes, photos), Tripadvisor reviews and listing mirrors (address, check-in and
check-out times, no breakfast, no reception, car park), MDN and Chrome documentation for CSS scroll-driven animations (supported in
Chromium 115+ and Safari 26; not yet Baseline because of Firefox), Meta documentation for WhatsApp Cloud API templates and the 24-hour window.
