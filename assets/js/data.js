// Property content. Sources: public Booking.com listing, Tripadvisor, hotels-in-it and Expedia pages (October 2026).
// Room inventory (one unit per room type), rates and contacts are DEMO values: confirm each with the owner.

export const PROPERTY = {
  name: "Fabrì 171",
  fullName: "Fabrì 171 · Guest house",
  address: "Via Nicola Fabrizi 171, Scala C",
  city: "Pescara",
  area: "Centro, tra stazione e mare",
  checkInFrom: "14:00",
  checkInTo: "23:00",
  checkOutBy: "10:00",
  cin: "IT068028B4IGCFTBHB",
  // Booking.com category scores read on the listing (October 2026). Overall 8.5 from 385 reviews comes from an
  // aggregator that mirrors Booking.com: verify on the live listing.
  ratings: { overall: 8.5, count: 385, location: 9.5, comfort: 8.9, staff: 8.7, cleanliness: 8.8, value: 8.6, wifi: 9.0 },
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Via+Nicola+Fabrizi+171+Pescara",
  listingUrl: "https://www.booking.com/hotel/it/fabri-171.html",
  reviewsUrl: "https://www.booking.com/hotel/it/fabri-171.html#tab-reviews",
  // ponytail: placeholder contacts, one place to change. The WhatsApp buttons point to a fake number until set.
  phone: "+39 000 000 0000",
  whatsapp: "390000000000",
  email: "info@esempio.it",
  directDiscount: 0.1, // direct price ~10% under the portals (proposal)
  codePrefix: "FBR",
};

// Booking.com lists three room types. Guests per room come from the listing (sofa beds included).
export const ROOMS = [
  {
    id: "economy",
    name: "Economy",
    type: "Doppia o twin Economy",
    bed: "Letto matrimoniale o due singoli",
    guests: 2,
    rate: 58,
    color: "#e4d5bb",
    deep: "#5a4630",
    dark: false,
    blurb: "Il punto di partenza giusto: letto matrimoniale (o due singoli), scrivania, aria condizionata e un bagno privato con doccia walk-in e bidet. Dalla stazione al mare si fa tutto a piedi.",
    features: ["Aria condizionata", "Bagno privato con bidet", "Scrivania", "TV satellitare"],
    images: ["bed"], // concept images from Higgsfield (see README): swap in the owner's photos
    en: {
      type: "Economy double or twin",
      bed: "Double bed or two singles",
      blurb: "The right place to start: a double bed (or two singles), desk, air conditioning and a private bathroom with walk-in shower and bidet. Station to sea, all on foot.",
      features: ["Air conditioning", "Private bathroom with bidet", "Work desk", "Satellite TV"],
    },
  },
  {
    id: "triple",
    name: "Comfort Triple",
    type: "Tripla Comfort",
    bed: "Letto king + divano letto, oppure due singoli + divano letto",
    guests: 3,
    rate: 78,
    color: "#d9b98f",
    deep: "#6b4a22",
    dark: false,
    blurb: "Per tre: un letto king (o due singoli) e un divano letto, con lo spazio che gli ospiti ricordano. Accappatoi e biancheria sempre pronti.",
    features: ["Divano letto", "Accappatoi", "Bagno privato con bidet", "Aria condizionata"],
    images: ["hero"],
    en: {
      type: "Comfort triple",
      bed: "King bed + sofa bed, or two singles + sofa bed",
      blurb: "For three: a king bed (or two singles) and a sofa bed, with the space guests remember. Bathrobes and linen always ready.",
      features: ["Sofa bed", "Bathrobes", "Private bathroom with bidet", "Air conditioning"],
    },
  },
  {
    id: "quad",
    name: "Quadruple",
    type: "Quadrupla",
    bed: "Letto king + 2 divani letto, oppure due singoli + 2 divani letto",
    guests: 4,
    rate: 98,
    color: "#a9bccf",
    deep: "#2d4a66",
    dark: false,
    blurb: "Per famiglie e piccoli gruppi: letto king (o due singoli) e due divani letto. Culla gratuita su richiesta e bollitore in camera.",
    features: ["Due divani letto", "Culla gratuita su richiesta", "Bollitore", "Aria condizionata"],
    images: ["hero"],
    en: {
      type: "Quadruple",
      bed: "King bed + 2 sofa beds, or two singles + 2 sofa beds",
      blurb: "For families and small groups: a king bed (or two singles) and two sofa beds. Free cot on request and a kettle in the room.",
      features: ["Two sofa beds", "Free cot on request", "Kettle", "Air conditioning"],
    },
  },
];

// Guest quotes from the Booking.com listing. To be used only with the owner's OK (see README checklist).
export const REVIEWS = [
  { who: "Matthew", from: "United Kingdom", text: "Great location, right in between the station and beach. Clean, tidy and spacious." },
  { who: "Giannina", from: "United States", text: "Wonderful, clean, comfortable room. Only a three minute walk to the beach." },
  { who: "Ekaterine", from: "Georgia", text: "The owner was very responsive and replied to messages quickly." },
  { who: "Silviu", from: "Romania", text: "2 minutes walk to the central square and 5 minutes walk to the beach." },
];

export const roomById = (id) => ROOMS.find((r) => r.id === id);
