// WhatsApp message copy. Placeholders look like {name}; each template lists its variables in `order`,
// which maps to Meta's positional {{1}}, {{2}}… when you submit the template for approval (category: utility).
// Messages sent first by the business must use an approved template; free text only works inside the
// 24-hour window after the guest writes. Copy below is a DEMO proposal: confirm the check-in procedure with the owner.

const ACCESS = {
  it: "Siamo al civico 171, scala C. Quando sei a circa 10 minuti scrivici qui: un nostro host ti aspetta e ti accompagna in camera.",
  en: "We are at number 171, staircase C. When you are about 10 minutes away, message us here: one of our hosts will meet you and show you to your room.",
};

export const accessText = (lang) => ACCESS[lang];

export const TEMPLATES = {
  booking_confirmed: {
    order: ["name", "code", "property", "rooms", "checkIn", "checkOut", "window"],
    it: "Ciao {name}, la tua prenotazione {code} a {property} è confermata: {rooms}, arrivo {checkIn}, partenza {checkOut}. Check-in dalle {window}. Due giorni prima dell'arrivo ti scriviamo qui con tutte le istruzioni.",
    en: "Hi {name}, your booking {code} at {property} is confirmed: {rooms}, arriving {checkIn}, leaving {checkOut}. Check-in {window}. Two days before you arrive we will message you here with all the details.",
  },
  pre_arrival: {
    order: ["name", "property", "address", "window", "access", "maps"],
    it: "Ciao {name}, manca poco! Ti aspettiamo da {property}, {address}. Check-in {window}. {access} Rispondi a questo messaggio con il tuo orario di arrivo, così troviamo tutto pronto. Mappa: {maps}",
    en: "Hi {name}, almost there! We look forward to welcoming you at {property}, {address}. Check-in {window}. {access} Reply to this message with your arrival time so everything is ready. Map: {maps}",
  },
  checkin_day: {
    order: ["name", "window", "address", "access"],
    it: "Buongiorno {name}, oggi è il giorno! Check-in {window} in {address}. {access} Il Wi-Fi è gratuito in tutta la struttura. Buon viaggio!",
    en: "Good morning {name}, today is the day! Check-in {window} at {address}. {access} Wi-Fi is free throughout the property. Safe travels!",
  },
  checkout_thanks: {
    order: ["name", "property", "review"],
    it: "Grazie {name}, è stato un piacere averti da {property}! Se ti sei trovato bene, una recensione ci aiuta molto: {review}. La prossima volta prenota direttamente dal nostro sito.",
    en: "Thank you {name}, it was a pleasure having you at {property}! If you enjoyed your stay, a review helps us a lot: {review}. Next time, book directly on our website.",
  },
  host_new_booking: {
    order: ["code", "name", "rooms", "checkIn", "checkOut", "total", "phone"],
    it: "Nuova prenotazione diretta {code}: {name}, {rooms}, dal {checkIn} al {checkOut}, {total}. Zero commissioni. Telefono ospite: {phone}.",
    en: "New direct booking {code}: {name}, {rooms}, {checkIn} to {checkOut}, {total}. No commission. Guest phone: {phone}.",
  },
  host_conflict: {
    order: ["rooms", "checkIn", "checkOut", "channel", "other"],
    it: "ATTENZIONE: doppia prenotazione in {rooms} dal {checkIn} al {checkOut} ({channel} e {other}). Chiudi le date sul portale o contatta l'ospite.",
    en: "WARNING: double booking in {rooms} from {checkIn} to {checkOut} ({channel} and {other}). Close the dates on the portal or contact the guest.",
  },
};
