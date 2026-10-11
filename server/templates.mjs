// WhatsApp message copy. Placeholders look like {name}; each template lists its variables in `order`,
// which maps to Meta's positional {{1}}, {{2}}… when you submit the template for approval (category: utility).
// Messages sent first by the business must use an approved template; free text only works inside the
// 24-hour window after the guest writes. Meta rejects a template that starts or ends with a variable:
// a test enforces that every text starts and ends with words.
// Tuttotondo has no reception: the check-in templates carry the door code ({accessCode}). The code is a DEMO value
// derived from the booking code (see accessCode in whatsapp.mjs); in real life it comes from the smart-lock API.
// Copy below is a DEMO proposal: confirm the check-in procedure with the owner.

const ACCESS = {
  it: "Non c'è reception: l'ingresso è autonomo, ma se ti serve qualcosa ci trovi qui su WhatsApp o al telefono.",
  en: "There is no reception: you let yourself in, and if you need anything you can reach us here on WhatsApp or by phone.",
};

export const accessText = (lang) => ACCESS[lang];

export const TEMPLATES = {
  booking_confirmed: {
    order: ["name", "code", "property", "rooms", "checkIn", "checkOut", "window"],
    it: "Ciao {name}, la tua prenotazione {code} a {property} è confermata: {rooms}, arrivo {checkIn}, partenza {checkOut}. Check-in autonomo {window}. Due giorni prima dell'arrivo ti scriviamo qui con le istruzioni e il codice della porta.",
    en: "Hi {name}, your booking {code} at {property} is confirmed: {rooms}, arriving {checkIn}, leaving {checkOut}. Self check-in {window}. Two days before you arrive we will message you here with the instructions and your door code.",
  },
  pre_arrival: {
    order: ["name", "property", "address", "window", "access", "accessCode", "maps"],
    it: "Ciao {name}, manca poco! Ti aspettiamo da {property}, {address}. Check-in {window}. {access} Il tuo codice porta è {accessCode}. Rispondi a questo messaggio con il tuo orario di arrivo, così sappiamo quando aspettarti. Mappa: {maps} A presto!",
    en: "Hi {name}, almost there! We look forward to welcoming you at {property}, {address}. Check-in {window}. {access} Your door code is {accessCode}. Reply to this message with your arrival time so we know when to expect you. Map: {maps} See you soon!",
  },
  checkin_day: {
    order: ["name", "window", "address", "access", "accessCode"],
    it: "Buongiorno {name}, oggi è il giorno! Check-in {window} in {address}. {access} Il tuo codice porta è {accessCode}. Il Wi-Fi è gratuito in tutta la struttura. Buon viaggio!",
    en: "Good morning {name}, today is the day! Check-in {window} at {address}. {access} Your door code is {accessCode}. Wi-Fi is free throughout the property. Safe travels!",
  },
  checkout_thanks: {
    order: ["name", "property", "review"],
    it: "Grazie {name}, è stato un piacere averti da {property}! Se il soggiorno ti è piaciuto, una recensione ci aiuta molto: {review}. La prossima volta prenota direttamente dal nostro sito.",
    en: "Thank you {name}, it was a pleasure having you at {property}! If you enjoyed your stay, a review helps us a lot: {review}. Next time, book directly on our website.",
  },
  host_new_booking: {
    order: ["code", "name", "rooms", "checkIn", "checkOut", "total", "phone"],
    it: "Nuova prenotazione diretta {code}: {name}, {rooms}, da {checkIn} a {checkOut}, {total}. Zero commissioni. Telefono ospite: {phone}.",
    en: "New direct booking {code}: {name}, {rooms}, {checkIn} to {checkOut}, {total}. No commission. Guest phone: {phone}.",
  },
  host_conflict: {
    order: ["rooms", "checkIn", "checkOut", "channel", "other"],
    it: "ATTENZIONE: doppia prenotazione in {rooms} da {checkIn} a {checkOut} ({channel} e {other}). Chiudi le date sul portale o contatta l'ospite.",
    en: "WARNING: double booking in {rooms} from {checkIn} to {checkOut} ({channel} and {other}). Close the dates on the portal or contact the guest.",
  },
};
