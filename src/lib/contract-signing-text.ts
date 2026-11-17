/**
 * The words a contract's signer reads (D695 step 3): the emails (a contract to sign, the code, a reminder, signed, declined) and the
 * signing page. In the contract's language, written by hand for Norwegian bokmål and English as the contract's own words are
 * (`contract-text.ts`); any other falls back to English. A function fills a name or a date the code wrote. Pure.
 */

export type SigningText = {
  toSign: { subject: (store: string) => string; heading: string; intro: (store: string, title: string) => string; until: (date: string) => string; button: string; notYou: string };
  storeTurn: { subject: (title: string) => string; intro: (title: string) => string; button: string };
  reminder: { subject: (store: string) => string; intro: (store: string, title: string) => string };
  code: { subject: (store: string) => string; intro: string; minutes: string };
  signed: { subject: (title: string) => string; heading: string; intro: (title: string) => string; attached: string };
  declined: { subject: (title: string) => string; intro: (name: string, title: string) => string; reason: (reason: string) => string; button: string };
  page: {
    title: string;
    from: (store: string) => string;
    until: (date: string) => string;
    download: string;
    signAs: (name: string) => string;
    step1: string;
    sendCode: string;
    codeSent: (email: string) => string;
    codeLabel: string;
    nameLabel: string;
    agree: string;
    sign: string;
    decline: string;
    declineReason: string;
    declineSend: string;
    signed: string;
    signedAt: (date: string) => string;
    declined: string;
    waitingEarlier: string;
    closed: { declined: string; expired: string; cancelled: string; signed: string };
    problems: { code: string; code_expired: string; too_many_tries: string; too_many: string; name: string; agree: string; closed: string; not_turn: string; expired: string; reason: string; not_found: string };
    who: { store: string; customer: string; other: string };
    signatureLine: string;
  };
};

const nb: SigningText = {
  toSign: {
    subject: (store) => `Kontrakt til signering fra ${store}`,
    heading: "En kontrakt til signering",
    intro: (store, title) => `${store} har sendt deg «${title}» til signering. Les den, og signer med en kode vi sender til e-posten din.`,
    until: (date) => `Den kan signeres til og med ${date}.`,
    button: "Les og signer",
    notYou: "Var ikke denne til deg? Da kan du se bort fra den.",
  },
  storeTurn: {
    subject: (title) => `Signer «${title}» for butikken`,
    intro: (title) => `«${title}» venter på signaturen din for butikken. Når du har signert, sendes den til kunden.`,
    button: "Åpne kontrakten",
  },
  reminder: {
    subject: (store) => `Påminnelse: kontrakt fra ${store} venter på signaturen din`,
    intro: (store, title) => `«${title}» fra ${store} venter fortsatt på signaturen din.`,
  },
  code: {
    subject: (store) => `Koden din for å signere hos ${store}`,
    intro: "Skriv inn denne koden på siden der du signerer:",
    minutes: "Koden gjelder i 10 minutter. Ba du ikke om den? Da kan du se bort fra denne e-posten.",
  },
  signed: {
    subject: (title) => `Signert: ${title}`,
    heading: "Kontrakten er signert",
    intro: (title) => `Alle har signert «${title}». Den signerte kontrakten er lagt ved, med en side som viser hvem som signerte og når.`,
    attached: "Ta vare på PDF-en: den er beseglet, så en endring i den vises når den åpnes.",
  },
  declined: {
    subject: (title) => `Avslått: ${title}`,
    intro: (name, title) => `${name} avslo «${title}».`,
    reason: (reason) => `Begrunnelse: ${reason}`,
    button: "Åpne kontrakten",
  },
  page: {
    title: "Kontrakt til signering",
    from: (store) => `Fra ${store}`,
    until: (date) => `Kan signeres til og med ${date}`,
    download: "Last ned PDF",
    signAs: (name) => `Signer som ${name}`,
    step1: "Først sender vi en kode til e-posten din, så vi vet at det er deg.",
    sendCode: "Send meg en kode",
    codeSent: (email) => `Vi har sendt en kode til ${email}.`,
    codeLabel: "Koden fra e-posten",
    nameLabel: "Fullt navn",
    agree: "Jeg har lest kontrakten og godtar den",
    sign: "Signer",
    decline: "Avslå",
    declineReason: "Hvorfor avslår du? (valgfritt)",
    declineSend: "Avslå kontrakten",
    signed: "Du har signert. Takk!",
    signedAt: (date) => `Signert ${date}`,
    declined: "Du har avslått kontrakten.",
    waitingEarlier: "Kontrakten venter på at noen signerer før deg. Du får en e-post når det er din tur.",
    closed: {
      declined: "Kontrakten er avslått og kan ikke signeres.",
      expired: "Fristen for å signere er ute.",
      cancelled: "Kontrakten er trukket tilbake.",
      signed: "Alle har signert kontrakten.",
    },
    problems: {
      code: "Koden stemmer ikke. Sjekk e-posten og prøv igjen.",
      code_expired: "Koden er utløpt. Be om en ny.",
      too_many_tries: "For mange forsøk med denne koden. Be om en ny.",
      too_many: "Du har bedt om mange koder. Vent litt og prøv igjen.",
      name: "Skriv det fulle navnet ditt.",
      agree: "Kryss av for at du har lest kontrakten og godtar den.",
      closed: "Kontrakten kan ikke signeres lenger.",
      not_turn: "Det er ikke din tur å signere ennå.",
      expired: "Fristen for å signere er ute.",
      reason: "Begrunnelsen kan være på høyst 500 tegn.",
      not_found: "Denne lenken virker ikke.",
    },
    who: { store: "For leverandøren", customer: "For kunden", other: "For kunden" },
    signatureLine: "Signert elektronisk med kode til e-post",
  },
};

const en: SigningText = {
  toSign: {
    subject: (store) => `A contract to sign from ${store}`,
    heading: "A contract to sign",
    intro: (store, title) => `${store} has sent you “${title}” to sign. Read it, and sign with a code we send to your email.`,
    until: (date) => `It can be signed until ${date}.`,
    button: "Read and sign",
    notYou: "Not meant for you? Then you can ignore it.",
  },
  storeTurn: {
    subject: (title) => `Sign “${title}” for the store`,
    intro: (title) => `“${title}” is waiting for your signature for the store. Once you have signed, it goes to the customer.`,
    button: "Open the contract",
  },
  reminder: {
    subject: (store) => `Reminder: a contract from ${store} is waiting for your signature`,
    intro: (store, title) => `“${title}” from ${store} is still waiting for your signature.`,
  },
  code: {
    subject: (store) => `Your code to sign with ${store}`,
    intro: "Type this code on the page where you sign:",
    minutes: "The code works for 10 minutes. Didn't ask for it? Then you can ignore this email.",
  },
  signed: {
    subject: (title) => `Signed: ${title}`,
    heading: "The contract is signed",
    intro: (title) => `Everyone has signed “${title}”. The signed contract is attached, with a page showing who signed and when.`,
    attached: "Keep the PDF: it is sealed, so any change to it shows when it is opened.",
  },
  declined: {
    subject: (title) => `Declined: ${title}`,
    intro: (name, title) => `${name} declined “${title}”.`,
    reason: (reason) => `Reason: ${reason}`,
    button: "Open the contract",
  },
  page: {
    title: "A contract to sign",
    from: (store) => `From ${store}`,
    until: (date) => `Can be signed until ${date}`,
    download: "Download the PDF",
    signAs: (name) => `Sign as ${name}`,
    step1: "First we send a code to your email, so we know it is you.",
    sendCode: "Send me a code",
    codeSent: (email) => `We have sent a code to ${email}.`,
    codeLabel: "The code from the email",
    nameLabel: "Full name",
    agree: "I have read the contract and agree to it",
    sign: "Sign",
    decline: "Decline",
    declineReason: "Why do you decline? (optional)",
    declineSend: "Decline the contract",
    signed: "You have signed. Thank you!",
    signedAt: (date) => `Signed ${date}`,
    declined: "You have declined the contract.",
    waitingEarlier: "The contract is waiting for someone to sign before you. You'll get an email when it is your turn.",
    closed: {
      declined: "The contract was declined and can no longer be signed.",
      expired: "The time to sign has passed.",
      cancelled: "The contract was withdrawn.",
      signed: "Everyone has signed the contract.",
    },
    problems: {
      code: "That code is not right. Check the email and try again.",
      code_expired: "The code has expired. Ask for a new one.",
      too_many_tries: "Too many tries with this code. Ask for a new one.",
      too_many: "You have asked for many codes. Wait a little and try again.",
      name: "Write your full name.",
      agree: "Tick that you have read the contract and agree to it.",
      closed: "The contract can no longer be signed.",
      not_turn: "It is not your turn to sign yet.",
      expired: "The time to sign has passed.",
      reason: "The reason can be at most 500 characters.",
      not_found: "This link does not work.",
    },
    who: { store: "For the supplier", customer: "For the customer", other: "For the customer" },
    signatureLine: "Signed electronically with a code to email",
  },
};

export const signingText = (language: string): SigningText => (language.toLowerCase().split("-")[0] === "nb" ? nb : en);

/** An address shown on the page as `k***@example.com`: enough to know which inbox, not a whole address for anyone holding the link. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}
