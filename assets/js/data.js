// Property content. Sources: public Booking.com listing (room types, amenities, scores), Tripadvisor reviews and
// listing mirrors (October 2026). Room inventory (one unit per room type), rates, contacts and the details marked
// "to confirm" are DEMO values: the owner checks each one (see README checklist).

export const PROPERTY = {
  name: "Tuttotondo",
  fullName: "Tuttotondo · Guest house",
  address: "Corso Vittorio Emanuele II 129",
  city: "Pescara",
  postcode: "65121",
  area: "Centro, tra stazione e mare",
  checkInFrom: "15:00",
  checkInTo: "24:00",
  checkOutBy: "10:00",
  cin: "IT068028B4HICAJULU",
  // Booking.com category scores read on the listing (October 2026). Overall 8.2 from 637 reviews comes from an
  // aggregator that mirrors Booking.com: verify on the live listing.
  ratings: { overall: 8.2, count: 637, location: 9.0, cleanliness: 8.7, wifi: 8.7, comfort: 8.5, staff: 8.5, facilities: 8.3, value: 8.2, couples: 8.9 },
  // Distances from the public listing. The car park (300 m, about 2.50 EUR a day) comes from one Tripadvisor review: to confirm.
  near: { stationM: 800, beachWalkMin: 8, museumLessThanM: 1000, airportKm: 6, parkingM: 300, parkingPerDay: 2.5 },
  cribPerNight: 15, // per child per night, ages 0–3; no extra beds
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Corso+Vittorio+Emanuele+II+129+Pescara",
  // ponytail: the exact Booking.com page was not found while researching, so these two are searches. Replace with the real links.
  listingUrl: "https://www.booking.com/searchresults.html?ss=Tuttotondo+Pescara",
  reviewsUrl: "https://www.booking.com/searchresults.html?ss=Tuttotondo+Pescara",
  // ponytail: placeholder contacts, one place to change. The WhatsApp buttons point to a fake number until set.
  phone: "+39 000 000 0000",
  whatsapp: "390000000000",
  email: "info@esempio.it",
  directDiscount: 0.1, // direct price ~10% under the portals (proposal)
  codePrefix: "TTD",
};

// The five Booking.com room types, one room each. Capacities and beds come from the listing; every room has
// A/C, private bathroom, TV, bathrobes, free toiletries, free Wi-Fi, work desk, mosquito net and a coffee machine,
// so the feature lists below only pick from that common set. Names are language-neutral because the WhatsApp
// messages and the iCal feeds use them as they are. `crop` frames the concept image inside a round mask.
export const ROOMS = [
  {
    id: "bath",
    name: "Double Bath",
    type: "Doppia con bagno privato",
    bed: "1 letto king",
    guests: 2,
    rate: 68,
    color: "#efc9be",
    dark: false,
    blurb: "Un letto king, bagno privato, aria condizionata e scrivania: l'essenziale fatto bene, a otto minuti a piedi dal mare.",
    features: ["Letto king", "Bagno privato", "Aria condizionata", "Scrivania"],
    images: ["hero"], // concept images (AI generated, see README): swap in the owner's photos
    crop: { x: "28%", y: "24%", zoom: 2.2 },
    en: {
      type: "Double room with private bathroom",
      bed: "1 king bed",
      blurb: "A king bed, private bathroom, air conditioning and a work desk: the essentials done well, an eight-minute walk from the sea.",
      features: ["King bed", "Private bathroom", "Air conditioning", "Work desk"],
    },
  },
  {
    id: "double",
    name: "Double",
    type: "Camera doppia",
    bed: "1 letto matrimoniale",
    guests: 2,
    rate: 55,
    color: "#b9c2ad",
    dark: false,
    blurb: "La scelta più semplice: letto matrimoniale, aria condizionata, TV e Wi-Fi gratuito, con la zanzariera per le sere d'estate.",
    features: ["Letto matrimoniale", "Wi-Fi gratuito", "TV", "Zanzariera"],
    images: ["terrace"],
    crop: { x: "62%", y: "38%", zoom: 1.9 },
    en: {
      type: "Double room",
      bed: "1 full bed",
      blurb: "The simplest choice: a full bed, air conditioning, TV and free Wi-Fi, with a mosquito net for summer evenings.",
      features: ["Full bed", "Free Wi-Fi", "TV", "Mosquito net"],
    },
  },
  {
    id: "large",
    name: "Large Double",
    type: "Camera doppia ampia",
    bed: "1 letto king",
    guests: 2,
    rate: 78,
    color: "#f4c79b",
    dark: false,
    blurb: "Più spazio, sempre un letto king: per chi vuole muoversi con calma, con scrivania, accappatoi e prodotti da bagno gratuiti.",
    features: ["Letto king", "Più spazio", "Accappatoi", "Prodotti da bagno gratuiti"],
    images: ["hero"],
    crop: { x: "74%", y: "34%", zoom: 1.5 },
    en: {
      type: "Large double room",
      bed: "1 king bed",
      blurb: "More space, still a king bed: for those who like to move around, with a work desk, bathrobes and free toiletries.",
      features: ["King bed", "More space", "Bathrobes", "Free toiletries"],
    },
  },
  {
    id: "standard",
    name: "Standard Double",
    type: "Camera doppia standard",
    bed: "1 letto queen",
    guests: 2,
    rate: 62,
    color: "#e8a98f",
    dark: false,
    blurb: "Letto queen, bagno privato e tutto quello che serve per un weekend in città: Wi-Fi gratuito, TV e aria condizionata.",
    features: ["Letto queen", "Bagno privato", "Wi-Fi gratuito", "TV"],
    images: ["hero"],
    crop: { x: "62%", y: "90%", zoom: 1.7 },
    en: {
      type: "Standard double room",
      bed: "1 queen bed",
      blurb: "A queen bed, private bathroom and everything you need for a city weekend: free Wi-Fi, TV and air conditioning.",
      features: ["Queen bed", "Private bathroom", "Free Wi-Fi", "TV"],
    },
  },
  {
    id: "triple",
    name: "Triple",
    type: "Camera tripla",
    bed: "1 letto king + 1 divano letto",
    guests: 3,
    rate: 85,
    color: "#d9805b",
    dark: false,
    blurb: "Per viaggiare in tre: un letto king e un divano letto, bagno privato e aria condizionata, a metà strada tra stazione e mare.",
    features: ["Letto king + divano letto", "Bagno privato", "TV", "Aria condizionata"],
    images: ["terrace"],
    crop: { x: "50%", y: "80%", zoom: 1.5 },
    en: {
      type: "Triple room",
      bed: "1 king bed + 1 sofa bed",
      blurb: "For three travellers: a king bed and a sofa bed, private bathroom and air conditioning, halfway between the station and the sea.",
      features: ["King bed + sofa bed", "Private bathroom", "TV", "Air conditioning"],
    },
  },
];

// Guest quotes from the Booking.com listing, shown verbatim (original English, typos included).
// To be used only with the owner's OK (see README checklist).
export const REVIEWS = [
  { who: "Valentin", from: "Romania", text: "The host was really nice and the check-in process was simple at any hour!" },
  { who: "Sobbetti", from: "United Kingdom", text: "Super easy check in. Clean, cosy and pretty. Quiet." },
  { who: "Nicolas", from: "Belgium", text: "Host reactivity, localisation, sound insulation, everything which was there was perfectly functionnal" },
  { who: "Lesley", from: "United Kingdom", text: "Very comfy room, excellent communication & good location" },
  { who: "Francesca", from: "United Kingdom", text: "The staff were incredibly helpful when I locked myself out of my room!" },
];

export const roomById = (id) => ROOMS.find((r) => r.id === id);
