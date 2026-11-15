/**
 * Telling a customer how their order stands (`docs/100-day-challenge.md` C, D635): the store's own fixed words, never a model's, so what a
 * customer is told is only what the store's records say. Four updates: an order that is taking longer, a parcel the carrier could not deliver,
 * a parcel the carrier has a problem with, and a parcel on its way back. Each promises nothing the store cannot keep: no date, no refund, no
 * amount. Pure: the kinds and the words in the languages the order emails are written in by hand (nb, sv, da, en; English for the rest).
 */

export const ORDER_UPDATES = ["delayed", "parcel_attempted", "parcel_problem", "parcel_returning"] as const;
export type OrderUpdate = (typeof ORDER_UPDATES)[number];

/** The tracking phase an update about a parcel needs its latest tracking to be in (`shipment_tracking.phase`); a delay needs none. */
export const UPDATE_PHASE: Readonly<Record<Exclude<OrderUpdate, "delayed">, "attempted" | "problem" | "returned_to_sender">> = {
  parcel_attempted: "attempted",
  parcel_problem: "problem",
  parcel_returning: "returned_to_sender",
};

export type OrderUpdateWords = {
  subject: (store: string, number: string) => string;
  heading: string;
  intro: (number: string) => string;
};

type Lang = "nb" | "sv" | "da" | "en";

const WORDS: Record<Lang, Record<OrderUpdate, OrderUpdateWords>> = {
  nb: {
    delayed: {
      subject: (store, number) => `Ordre ${number} hos ${store} tar litt lenger tid`,
      heading: "Bestillingen din tar litt lenger tid",
      intro: (number) =>
        `Vi har ikke fått sendt ordre ${number} så raskt som vi håpet. Vi jobber med den og sender deg en e-post så snart den er på vei. Svar på denne e-posten hvis du har spørsmål.`,
    },
    parcel_attempted: {
      subject: (store, number) => `Vi fikk ikke levert pakken fra ordre ${number} hos ${store}`,
      heading: "Transportøren fikk ikke levert pakken",
      intro: (number) =>
        `Transportøren prøvde å levere pakken fra ordre ${number}, men fikk det ikke til. Følg meldingen fra transportøren eller sporingen for å velge et nytt tidspunkt eller et hentested.`,
    },
    parcel_problem: {
      subject: (store, number) => `Om pakken fra ordre ${number} hos ${store}`,
      heading: "Transportøren melder om et problem med pakken",
      intro: (number) =>
        `Transportøren melder om et problem med pakken fra ordre ${number}. Vi ser på det og gir deg beskjed. Svar på denne e-posten hvis du har spørsmål.`,
    },
    parcel_returning: {
      subject: (store, number) => `Pakken fra ordre ${number} hos ${store} er på vei tilbake`,
      heading: "Pakken din er på vei tilbake til oss",
      intro: (number) =>
        `Pakken fra ordre ${number} er på vei tilbake til oss. Vi tar kontakt om hva som skjer videre. Svar på denne e-posten hvis du har spørsmål.`,
    },
  },
  sv: {
    delayed: {
      subject: (store, number) => `Order ${number} hos ${store} tar lite längre tid`,
      heading: "Din beställning tar lite längre tid",
      intro: (number) =>
        `Vi har inte kunnat skicka order ${number} så snabbt som vi hoppades. Vi arbetar med den och mejlar dig så snart den är på väg. Svara på det här mejlet om du har frågor.`,
    },
    parcel_attempted: {
      subject: (store, number) => `Vi kunde inte leverera paketet från order ${number} hos ${store}`,
      heading: "Transportören kunde inte leverera paketet",
      intro: (number) =>
        `Transportören försökte leverera paketet från order ${number} men lyckades inte. Följ transportörens avisering eller spårningen för att välja en ny tid eller ett utlämningsställe.`,
    },
    parcel_problem: {
      subject: (store, number) => `Om paketet från order ${number} hos ${store}`,
      heading: "Transportören rapporterar ett problem med paketet",
      intro: (number) =>
        `Transportören rapporterar ett problem med paketet från order ${number}. Vi tittar på det och hör av oss. Svara på det här mejlet om du har frågor.`,
    },
    parcel_returning: {
      subject: (store, number) => `Paketet från order ${number} hos ${store} är på väg tillbaka`,
      heading: "Ditt paket är på väg tillbaka till oss",
      intro: (number) =>
        `Paketet från order ${number} är på väg tillbaka till oss. Vi hör av oss om vad som händer härnäst. Svara på det här mejlet om du har frågor.`,
    },
  },
  da: {
    delayed: {
      subject: (store, number) => `Ordre ${number} hos ${store} tager lidt længere tid`,
      heading: "Din bestilling tager lidt længere tid",
      intro: (number) =>
        `Vi har ikke kunnet sende ordre ${number} så hurtigt, som vi håbede. Vi arbejder på den og sender dig en e-mail, så snart den er på vej. Svar på denne e-mail, hvis du har spørgsmål.`,
    },
    parcel_attempted: {
      subject: (store, number) => `Vi kunne ikke levere pakken fra ordre ${number} hos ${store}`,
      heading: "Transportøren kunne ikke levere pakken",
      intro: (number) =>
        `Transportøren forsøgte at levere pakken fra ordre ${number}, men det lykkedes ikke. Følg transportørens besked eller sporingen for at vælge et nyt tidspunkt eller et afhentningssted.`,
    },
    parcel_problem: {
      subject: (store, number) => `Om pakken fra ordre ${number} hos ${store}`,
      heading: "Transportøren melder om et problem med pakken",
      intro: (number) =>
        `Transportøren melder om et problem med pakken fra ordre ${number}. Vi ser på det og giver dig besked. Svar på denne e-mail, hvis du har spørgsmål.`,
    },
    parcel_returning: {
      subject: (store, number) => `Pakken fra ordre ${number} hos ${store} er på vej tilbage`,
      heading: "Din pakke er på vej tilbage til os",
      intro: (number) =>
        `Pakken fra ordre ${number} er på vej tilbage til os. Vi kontakter dig om, hvad der sker nu. Svar på denne e-mail, hvis du har spørgsmål.`,
    },
  },
  en: {
    delayed: {
      subject: (store, number) => `Order ${number} at ${store} is taking a little longer`,
      heading: "Your order is taking a little longer",
      intro: (number) =>
        `We have not been able to send order ${number} as quickly as we hoped. We are working on it and will email you as soon as it is on its way. Reply to this email if you have any questions.`,
    },
    parcel_attempted: {
      subject: (store, number) => `We could not deliver the parcel from order ${number} at ${store}`,
      heading: "The carrier could not deliver your parcel",
      intro: (number) =>
        `The carrier tried to deliver the parcel from order ${number} but could not. Follow the carrier's notice or the tracking to choose a new time or a pickup point.`,
    },
    parcel_problem: {
      subject: (store, number) => `About the parcel from order ${number} at ${store}`,
      heading: "The carrier reports a problem with your parcel",
      intro: (number) =>
        `The carrier reports a problem with the parcel from order ${number}. We are looking into it and will let you know. Reply to this email if you have any questions.`,
    },
    parcel_returning: {
      subject: (store, number) => `The parcel from order ${number} at ${store} is on its way back`,
      heading: "Your parcel is on its way back to us",
      intro: (number) =>
        `The parcel from order ${number} is on its way back to us. We will be in touch about what happens next. Reply to this email if you have any questions.`,
    },
  },
};

/** An update's words in a language: nb, sv, da or en by hand, English for every other language. */
export const orderUpdateWords = (lang: string, update: OrderUpdate): OrderUpdateWords => WORDS[(lang in WORDS ? lang : "en") as Lang][update];

/** What each update says, in the owner's words, for the tool's answer and the approval. */
export const UPDATE_WORDS: Readonly<Record<OrderUpdate, string>> = {
  delayed: "the order is taking longer than planned and they will hear when it is on its way",
  parcel_attempted: "the carrier could not deliver the parcel and how to choose a new time or a pickup point",
  parcel_problem: "the carrier reports a problem with the parcel and the store is looking into it",
  parcel_returning: "the parcel is on its way back and the store will be in touch",
};
