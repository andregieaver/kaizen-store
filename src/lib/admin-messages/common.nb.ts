import type { CommonMessages } from "./common.en";

/** Administrasjonens felles ord på norsk bokmål (D312 A0), skrevet for hånd mot ordlisten (`src/lib/i18n-glossary.ts`). */
export const commonNb: CommonMessages = {
  orderStatus: {
    pending_payment: "Venter på betaling",
    authorized: "Beløpet er reservert, skal belastes",
    paid: "Betalt, skal sendes",
    fulfilled: "Sendt",
    cancelled: "Ikke fullført",
    closed: "Avsluttet",
  },
  accountMenu: {
    yourAccount: "Din konto",
    contactSupport: "Kontakt kundestøtten i Kaizena Flow",
    colours: "Farger",
    toDark: "Bytt til mørke farger",
    toLight: "Bytt til lyse farger",
    language: "Språk",
    signOut: "Logg ut",
  },
  form: {
    working: "Arbeider …",
    show: "Vis",
    hide: "Skjul",
    delete: "Slett",
    deleting: "Sletter …",
  },
  language: {
    title: "Språk",
    description: "Språket administrasjonen vises på for deg. Kundene i butikkene dine ser språkene som er valgt for hver butikk.",
    saving: "Lagrer …",
    kept: "Lagres med kontoen din, så administrasjonen har samme språk på alle enheter du logger inn på.",
    partly: "Deler av administrasjonen som ennå ikke er skrevet på ditt språk, vises på engelsk.",
  },
};
