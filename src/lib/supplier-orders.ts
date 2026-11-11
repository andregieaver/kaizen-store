/**
 * Supplier orders (drop shipping, D551, `docs/drop-shipping.md` 4 and 5), the pure parts: which order lines a supplier is asked to send from
 * the units a payment drew at its location, the supplier's states, and the words of its email and page in the language the store chose for it
 * (the store's document languages). `src/server/supplier-orders.ts` is the only writer.
 */

import type { DocumentLanguage } from "./invoice-text";

export const SUPPLIER_ORDER_STATES = ["waiting", "sent", "shipped", "problem", "cancelled"] as const;
export type SupplierOrderState = (typeof SUPPLIER_ORDER_STATES)[number];

/** The days a supplier's page stays open after its order is sent. */
export const SUPPLIER_LINK_DAYS = 60;

/** The longest note a supplier can leave when it cannot send a line. */
export const SUPPLIER_PROBLEM_MAX = 500;

/** The carriers a supplier chooses from on its page (ids of `CARRIERS` in `src/server/order-admin.ts`); `other` takes a tracking link. */
export const SUPPLIER_CARRIERS = ["posten", "bring", "postnord", "dhl", "dhl_paket", "ups", "instabox", "other"] as const;
export type SupplierCarrier = (typeof SUPPLIER_CARRIERS)[number];

export type SoldAtSupplier = { variantId: string; units: number };
export type OrderLineForSupplier = { id: string; variantId: string | null; quantity: number };

/**
 * The lines a supplier is asked to send: the units the payment drew at its location, per variant, laid over the order's lines of that variant in
 * their order (a variant on two lines fills the first, then the next). Units beyond the lines are dropped (never more than was bought).
 */
export function supplierLines(sold: readonly SoldAtSupplier[], lines: readonly OrderLineForSupplier[]): { orderLineId: string; quantity: number }[] {
  const left = new Map<string, number>();
  for (const s of sold) if (s.units > 0) left.set(s.variantId, (left.get(s.variantId) ?? 0) + Math.floor(s.units));
  const out: { orderLineId: string; quantity: number }[] = [];
  for (const line of lines) {
    if (!line.variantId) continue;
    const have = left.get(line.variantId) ?? 0;
    const take = Math.min(have, Math.max(0, Math.floor(line.quantity)));
    if (take <= 0) continue;
    out.push({ orderLineId: line.id, quantity: take });
    left.set(line.variantId, have - take);
  }
  return out;
}

export type SupplierWords = {
  subject: string;
  preview: string;
  heading: string;
  intro: string;
  send: string;
  shipTo: string;
  note: string;
  button: string;
  after: string;
  footer: string;
  /** The page. */
  pageTitle: string;
  pageIntro: string;
  quantity: string;
  carrier: string;
  tracking: string;
  trackingUrl: string;
  markSent: string;
  sentDone: string;
  alreadySent: string;
  cannotSend: string;
  cannotSendIntro: string;
  reason: string;
  reportProblem: string;
  problemDone: string;
  cancelled: string;
  gone: string;
  other: string;
  badTracking: string;
  badLink: string;
  refused: string;
  badReason: string;
  reminderSubject: string;
  reminderIntro: string;
};

const WORDS: Record<DocumentLanguage, SupplierWords> = {
  en: {
    subject: "Order {number} from {store}: please send",
    preview: "What to send and where, for {store}.",
    heading: "Please send order {number}",
    intro: "{store} has sold these items, which you send for them. Send them to the address below and add the tracking number on the order's page.",
    send: "What to send",
    shipTo: "Send to",
    note: "A note from {store}",
    button: "Open the order and add tracking",
    after: "The customer bought from {store}: anything in the parcel should be in {store}'s name, not yours.",
    footer: "Sent by Kaizena Flow for {store}. This link is for you alone and works for {days} days.",
    pageTitle: "Order {number} from {store}",
    pageIntro: "Send these items to the address below, then add the carrier and the tracking number. The customer is told by {store}.",
    quantity: "Quantity",
    carrier: "Carrier",
    tracking: "Tracking number",
    trackingUrl: "Tracking link (for another carrier)",
    markSent: "Mark as sent",
    sentDone: "Thank you. The parcel is recorded and the customer is told.",
    alreadySent: "This order is marked as sent. Thank you.",
    cannotSend: "Can't send it?",
    cannotSendIntro: "Tell {store} what is wrong, such as an item that is out of stock. They decide what happens next.",
    reason: "What is wrong",
    reportProblem: "Tell {store}",
    problemDone: "{store} has been told. They will be in touch.",
    cancelled: "This order was cancelled. Please do not send it.",
    gone: "This link has ended or is not right. Ask the store for a new one.",
    other: "Another carrier",
    badTracking: "Check the tracking number: letters, digits, spaces and dashes.",
    badLink: "A tracking link starts with https://.",
    refused: "The parcel could not be recorded. Please tell {store}.",
    badReason: "Write a few words about what is wrong.",
    reminderSubject: "Reminder: order {number} from {store} is not marked as sent",
    reminderIntro: "{store} has not had tracking for this order within the {days} working days you send within. Send it, or tell them on the order's page why you cannot.",
  },
  nb: {
    subject: "Ordre {number} fra {store}: vennligst send",
    preview: "Hva som skal sendes og hvor, for {store}.",
    heading: "Vennligst send ordre {number}",
    intro: "{store} har solgt disse varene, som du sender for dem. Send dem til adressen under og legg inn sporingsnummeret på ordrens side.",
    send: "Hva som skal sendes",
    shipTo: "Send til",
    note: "En merknad fra {store}",
    button: "Åpne ordren og legg inn sporing",
    after: "Kunden kjøpte fra {store}: alt i pakken skal være i {store}s navn, ikke ditt.",
    footer: "Sendt av Kaizena Flow for {store}. Lenken er bare for deg og virker i {days} dager.",
    pageTitle: "Ordre {number} fra {store}",
    pageIntro: "Send disse varene til adressen under, og legg så inn transportør og sporingsnummer. Kunden får beskjed fra {store}.",
    quantity: "Antall",
    carrier: "Transportør",
    tracking: "Sporingsnummer",
    trackingUrl: "Sporingslenke (for en annen transportør)",
    markSent: "Merk som sendt",
    sentDone: "Takk. Pakken er registrert, og kunden har fått beskjed.",
    alreadySent: "Denne ordren er merket som sendt. Takk.",
    cannotSend: "Kan du ikke sende den?",
    cannotSendIntro: "Fortell {store} hva som er galt, for eksempel en vare som er utsolgt. De bestemmer hva som skjer videre.",
    reason: "Hva er galt",
    reportProblem: "Gi beskjed til {store}",
    problemDone: "{store} har fått beskjed. De tar kontakt.",
    cancelled: "Denne ordren er kansellert. Ikke send den.",
    gone: "Lenken er utløpt eller ikke riktig. Be butikken om en ny.",
    other: "En annen transportør",
    badTracking: "Sjekk sporingsnummeret: bokstaver, tall, mellomrom og bindestreker.",
    badLink: "En sporingslenke begynner med https://.",
    refused: "Pakken kunne ikke registreres. Gi beskjed til {store}.",
    badReason: "Skriv noen ord om hva som er galt.",
    reminderSubject: "Påminnelse: ordre {number} fra {store} er ikke merket som sendt",
    reminderIntro: "{store} har ikke fått sporing for denne ordren innen de {days} virkedagene du sender innen. Send den, eller fortell dem på ordrens side hvorfor du ikke kan.",
  },
  sv: {
    subject: "Order {number} från {store}: vänligen skicka",
    preview: "Vad som ska skickas och vart, för {store}.",
    heading: "Vänligen skicka order {number}",
    intro: "{store} har sålt de här varorna, som du skickar åt dem. Skicka dem till adressen nedan och lägg in spårningsnumret på orderns sida.",
    send: "Vad som ska skickas",
    shipTo: "Skicka till",
    note: "Ett meddelande från {store}",
    button: "Öppna ordern och lägg in spårning",
    after: "Kunden köpte från {store}: allt i paketet ska vara i {store}s namn, inte ditt.",
    footer: "Skickat av Kaizena Flow för {store}. Länken är bara för dig och fungerar i {days} dagar.",
    pageTitle: "Order {number} från {store}",
    pageIntro: "Skicka de här varorna till adressen nedan och lägg sedan in transportör och spårningsnummer. Kunden får besked av {store}.",
    quantity: "Antal",
    carrier: "Transportör",
    tracking: "Spårningsnummer",
    trackingUrl: "Spårningslänk (för en annan transportör)",
    markSent: "Markera som skickad",
    sentDone: "Tack. Paketet är registrerat och kunden har fått besked.",
    alreadySent: "Den här ordern är markerad som skickad. Tack.",
    cannotSend: "Kan du inte skicka den?",
    cannotSendIntro: "Berätta för {store} vad som är fel, till exempel en vara som är slut. De bestämmer vad som händer sedan.",
    reason: "Vad är fel",
    reportProblem: "Meddela {store}",
    problemDone: "{store} har fått besked. De hör av sig.",
    cancelled: "Den här ordern är avbruten. Skicka den inte.",
    gone: "Länken har gått ut eller stämmer inte. Be butiken om en ny.",
    other: "En annan transportör",
    badTracking: "Kontrollera spårningsnumret: bokstäver, siffror, mellanslag och bindestreck.",
    badLink: "En spårningslänk börjar med https://.",
    refused: "Paketet kunde inte registreras. Meddela {store}.",
    badReason: "Skriv några ord om vad som är fel.",
    reminderSubject: "Påminnelse: order {number} från {store} är inte markerad som skickad",
    reminderIntro: "{store} har inte fått spårning för den här ordern inom de {days} arbetsdagar du skickar inom. Skicka den, eller berätta på orderns sida varför du inte kan.",
  },
  da: {
    subject: "Ordre {number} fra {store}: send venligst",
    preview: "Hvad der skal sendes og hvorhen, for {store}.",
    heading: "Send venligst ordre {number}",
    intro: "{store} har solgt disse varer, som du sender for dem. Send dem til adressen nedenfor, og tilføj trackingnummeret på ordrens side.",
    send: "Hvad der skal sendes",
    shipTo: "Send til",
    note: "En besked fra {store}",
    button: "Åbn ordren og tilføj tracking",
    after: "Kunden købte hos {store}: alt i pakken skal være i {store}s navn, ikke dit.",
    footer: "Sendt af Kaizena Flow for {store}. Linket er kun til dig og virker i {days} dage.",
    pageTitle: "Ordre {number} fra {store}",
    pageIntro: "Send disse varer til adressen nedenfor, og tilføj derefter fragtfirma og trackingnummer. Kunden får besked fra {store}.",
    quantity: "Antal",
    carrier: "Fragtfirma",
    tracking: "Trackingnummer",
    trackingUrl: "Trackinglink (for et andet fragtfirma)",
    markSent: "Markér som sendt",
    sentDone: "Tak. Pakken er registreret, og kunden har fået besked.",
    alreadySent: "Denne ordre er markeret som sendt. Tak.",
    cannotSend: "Kan du ikke sende den?",
    cannotSendIntro: "Fortæl {store}, hvad der er galt, for eksempel en vare, der er udsolgt. De beslutter, hvad der sker derefter.",
    reason: "Hvad er galt",
    reportProblem: "Giv {store} besked",
    problemDone: "{store} har fået besked. De kontakter dig.",
    cancelled: "Denne ordre er annulleret. Send den ikke.",
    gone: "Linket er udløbet eller ikke korrekt. Bed butikken om et nyt.",
    other: "Et andet fragtfirma",
    badTracking: "Tjek trackingnummeret: bogstaver, tal, mellemrum og bindestreger.",
    badLink: "Et trackinglink begynder med https://.",
    refused: "Pakken kunne ikke registreres. Giv {store} besked.",
    badReason: "Skriv et par ord om, hvad der er galt.",
    reminderSubject: "Påmindelse: ordre {number} fra {store} er ikke markeret som sendt",
    reminderIntro: "{store} har ikke fået tracking for denne ordre inden for de {days} hverdage, du sender inden for. Send den, eller fortæl dem på ordrens side, hvorfor du ikke kan.",
  },
};

/** A supplier's words in its order language (English for any other). */
export const supplierWords = (lang: string): SupplierWords => WORDS[(lang in WORDS ? lang : "en") as DocumentLanguage];

/** The calendar days that cover a supplier's working days to send within, with a day's grace: a supplier is late after them. */
export const lateAfterDays = (dispatchDays: number): number => Math.ceil((Math.max(1, dispatchDays) * 7) / 5) + 1;

/** The prefix of a supplier API key (D553), so a key found in a log or a repository is known for what it is. */
export const SUPPLIER_KEY_PREFIX = "kzsp_";

/** Whether a tracking number as typed can be kept: 3 to 60 characters of letters, digits, spaces and dashes. */
export const isTrackingNumber = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9 -]{1,58}[A-Za-z0-9]$/.test(value.trim());
