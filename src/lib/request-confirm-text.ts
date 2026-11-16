/**
 * A request by email confirmed from the order's own address (B3, D685, `src/server/request-confirm.ts`): the email with its one-time link and
 * the page the link opens. Hand-written in Norwegian, Swedish, Danish and English, never machine-translated (it says what pressing Confirm
 * does), English for any other language. Legal: needs review, as the support emails do.
 */

export type RequestConfirmText = {
  subject: (store: string, order: string) => string;
  heading: string;
  intro: (order: string) => string;
  newAddress: string;
  button: string;
  /** Under the button: the link's lifetime, and what to do when the customer did not ask. */
  linkNote: (hours: number) => string;
  why: (store: string) => string;
  /** The page the link opens. */
  pageTitle: string;
  pageIntro: (order: string) => string;
  confirm: string;
  confirmed: string;
  /** The link is used, has run out, or the request was answered already. */
  closed: string;
};

const TEXT: Record<"nb" | "sv" | "da" | "en", RequestConfirmText> = {
  nb: {
    subject: (store, order) => `Bekreft forespørselen din om ordre ${order} hos ${store}`,
    heading: "Bekreft forespørselen din",
    intro: (order) => `Du har bedt oss om dette for ordre ${order}:`,
    newAddress: "Ny leveringsadresse:",
    button: "Bekreft",
    linkNote: (hours) => `Lenken virker i ${hours} timer og bare én gang. Har du ikke bedt om dette, kan du se bort fra e-posten: ingenting endres uten at du bekrefter.`,
    why: (store) => `Du får denne e-posten fordi noen skrev til ${store} om en ordre med denne adressen. Vi sender den hit for å være sikre på at det var deg.`,
    pageTitle: "Bekreft forespørselen",
    pageIntro: (order) => `Trykk Bekreft for at vi skal gjøre dette med ordre ${order}:`,
    confirm: "Bekreft",
    confirmed: "Takk, forespørselen er bekreftet. Du får beskjed når den er gjort.",
    closed: "Denne lenken kan ikke brukes lenger: den er brukt, har gått ut, eller forespørselen er alt besvart. Svar på e-posten vår hvis du trenger hjelp.",
  },
  sv: {
    subject: (store, order) => `Bekräfta din begäran om order ${order} hos ${store}`,
    heading: "Bekräfta din begäran",
    intro: (order) => `Du har bett oss om det här för order ${order}:`,
    newAddress: "Ny leveransadress:",
    button: "Bekräfta",
    linkNote: (hours) => `Länken fungerar i ${hours} timmar och bara en gång. Har du inte bett om det här kan du bortse från mejlet: inget ändras utan att du bekräftar.`,
    why: (store) => `Du får det här mejlet eftersom någon skrev till ${store} om en order med den här adressen. Vi skickar det hit för att vara säkra på att det var du.`,
    pageTitle: "Bekräfta begäran",
    pageIntro: (order) => `Tryck på Bekräfta så gör vi det här med order ${order}:`,
    confirm: "Bekräfta",
    confirmed: "Tack, din begäran är bekräftad. Du får besked när den är gjord.",
    closed: "Den här länken kan inte användas längre: den är använd, har gått ut eller så är begäran redan besvarad. Svara på vårt mejl om du behöver hjälp.",
  },
  da: {
    subject: (store, order) => `Bekræft din forespørgsel om ordre ${order} hos ${store}`,
    heading: "Bekræft din forespørgsel",
    intro: (order) => `Du har bedt os om dette for ordre ${order}:`,
    newAddress: "Ny leveringsadresse:",
    button: "Bekræft",
    linkNote: (hours) => `Linket virker i ${hours} timer og kun én gang. Har du ikke bedt om dette, kan du se bort fra e-mailen: intet ændres, uden at du bekræfter.`,
    why: (store) => `Du får denne e-mail, fordi nogen skrev til ${store} om en ordre med denne adresse. Vi sender den hertil for at være sikre på, at det var dig.`,
    pageTitle: "Bekræft forespørgslen",
    pageIntro: (order) => `Tryk Bekræft, så gør vi dette med ordre ${order}:`,
    confirm: "Bekræft",
    confirmed: "Tak, din forespørgsel er bekræftet. Du får besked, når den er gjort.",
    closed: "Dette link kan ikke bruges længere: det er brugt, er udløbet, eller forespørgslen er allerede besvaret. Svar på vores e-mail, hvis du har brug for hjælp.",
  },
  en: {
    subject: (store, order) => `Confirm your request about order ${order} at ${store}`,
    heading: "Confirm your request",
    intro: (order) => `You asked us to do this with order ${order}:`,
    newAddress: "New delivery address:",
    button: "Confirm",
    linkNote: (hours) => `The link works for ${hours} hours and only once. If you did not ask for this, ignore this email: nothing changes unless you confirm.`,
    why: (store) => `You get this email because someone wrote to ${store} about an order with this address. We send it here to be sure it was you.`,
    pageTitle: "Confirm the request",
    pageIntro: (order) => `Press Confirm and we will do this with order ${order}:`,
    confirm: "Confirm",
    confirmed: "Thank you, your request is confirmed. You will hear from us when it is done.",
    closed: "This link can no longer be used: it was used, it ran out, or the request was answered already. Reply to our email if you need help.",
  },
};

export function requestConfirmText(lang: string): RequestConfirmText {
  const short = lang.split("-")[0];
  return short in TEXT ? TEXT[short as keyof typeof TEXT] : TEXT.en;
}

/** How long the link to confirm a request by email works. */
export const REQUEST_CONFIRM_HOURS = 48;
