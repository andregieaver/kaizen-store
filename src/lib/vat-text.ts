/**
 * What the shopper's pages say about VAT that is not an ordinary price (D157, docs/wave-1a-tax.md sections 2.1 and 8): the
 * VAT number field, the reverse-charge and IOSS statements, the import notice, and the order page's VAT rows.
 *
 * LEGAL TEXT. Hand-written in nb, sv, da and en, plain and careful, never machine-translated and never claimed to be legal
 * advice. It is deliberately not part of `i18n.ts`'s messages, so the AI catalogue (`ui-catalog.ts`) never sees it and every
 * other language shows the English words. The statements an order carries (reverse charge, IOSS, the import notice, the
 * refund note) are the same words the emails use (`vatEmailText()`); this module adds what only the pages need.
 *
 * Needs review by a lawyer and an accountant before real use (docs/wave-1a-tax.md section 8).
 */
import { vatEmailText } from "./email-text";
import { ratePercent } from "./vat";

// legal: needs review
export type VatText = {
  /** The label of the field. */
  label: string;
  /** One sentence of help under the label. */
  help: string;
  check: string;
  checking: string;
  /** The row among the totals for the VAT a reverse-charge order does not charge (the shopper sees prices with VAT). */
  reliefRow: string;
  /** The VAT row of a business's totals when reverse charge applies. */
  vatLineReverse: string;
  /** The statement of a reverse-charge order, and the two numbers' labels. */
  reverseCharge: string;
  sellerNumber: string;
  buyerNumber: string;
  /** The IOSS statement with the store's IOSS number: said only of an order that has been paid. */
  ioss: (number: string) => string;
  /** What an order waiting for payment says instead: nothing has been collected yet, and no promise about delivery. */
  iossPending: (number: string) => string;
  importNotice: string;
  /** What the shopper is told about the number they typed (an outcome of the check). */
  outcome: {
    accepted: string;
    nothingTaxable: string;
    otherCountry: (numberCountry: string, deliveryCountry: string) => string;
    invalid: string;
    unavailable: string;
    ownNumber: string;
    notEu: string;
  };
  /** Something wrong with what was typed, or with the cart. */
  problem: {
    empty: string;
    noCountry: string;
    characters: string;
    shape: string;
    company: string;
    companyNumber: string;
    noCart: string;
    unsaved: string;
  };
  /** One line, instead of the field, for a basket the number cannot be used for. */
  basketService: string;
  basketSubscription: string;
  /** "Of which VAT 25 %": a row of the order page when the order has more than one rate. */
  vatAtRate: (rate: number) => string;
};

const TEXT: Record<"nb" | "sv" | "da" | "en", Omit<VatText, "reliefRow" | "reverseCharge" | "sellerNumber" | "buyerNumber" | "ioss" | "importNotice">> = {
  nb: {
    label: "Mva-nummer (EU)",
    help: "Bedriftens mva-nummer i EU, for eksempel DE123456789. Er det gyldig i landet varene sendes til, beregnes ikke mva., og dere beregner den selv i eget land (omvendt avgiftsplikt).",
    check: "Sjekk nummeret",
    checking: "Sjekker …",
    vatLineReverse: "Mva. (omvendt avgiftsplikt)",
    outcome: {
      accepted: "Mva-nummeret er godkjent. Det beregnes ikke mva. (omvendt avgiftsplikt).",
      nothingTaxable: "Mva-nummeret er godkjent. Disse varene har ingen mva.",
      otherCountry: (n, d) => `Nummeret gjelder ${n}, men varene sendes til ${d}. Mva. beregnes.`,
      invalid: "Mva-nummeret ble ikke godtatt. Mva. beregnes.",
      unavailable: "Mva-nummeret kunne ikke sjekkes akkurat nå. Mva. beregnes. Prøv igjen om litt.",
      ownNumber: "Dette er butikkens eget mva-nummer. Mva. beregnes.",
      notEu: "Bare mva-numre fra EU-land kan brukes her. Mva. beregnes.",
    },
    problem: {
      empty: "Skriv inn et mva-nummer.",
      noCountry: "Start nummeret med landkode, for eksempel DE.",
      characters: "Mva-nummeret kan bare inneholde bokstaver og tall.",
      shape: "Mva-nummeret ser ikke riktig ut. Sjekk det og prøv igjen.",
      company: "Fyll inn firmanavnet først.",
      companyNumber: "Sjekk organisasjonsnummeret først.",
      noCart: "Handlekurven ble ikke funnet. Last siden på nytt.",
      unsaved: "Sjekk mva-nummeret, eller tøm feltet for å betale med mva.",
    },
    basketService: "Mva-nummer kan ikke brukes når handlekurven har en time, et opphold eller en utleie. Mva. beregnes.",
    basketSubscription: "Mva-nummer kan ikke brukes når handlekurven har et abonnement. Mva. beregnes.",
    vatAtRate: (rate) => `herav mva. ${ratePercent(rate)}`,
    // legal: needs review
    iossPending: (number) => `Denne bestillingen gjelder IOSS (${number}). Mva. innkreves når bestillingen er betalt.`,
  },
  sv: {
    label: "Momsnummer (EU)",
    help: "Företagets momsnummer i EU, till exempel DE123456789. Är det giltigt i det land varorna skickas till debiteras ingen moms, och ni redovisar den själva i ert eget land (omvänd skattskyldighet).",
    check: "Kontrollera numret",
    checking: "Kontrollerar …",
    vatLineReverse: "Moms (omvänd skattskyldighet)",
    outcome: {
      accepted: "Momsnumret är godkänt. Ingen moms debiteras (omvänd skattskyldighet).",
      nothingTaxable: "Momsnumret är godkänt. De här varorna har ingen moms.",
      otherCountry: (n, d) => `Numret gäller ${n}, men varorna skickas till ${d}. Moms debiteras.`,
      invalid: "Momsnumret godkändes inte. Moms debiteras.",
      unavailable: "Momsnumret kunde inte kontrolleras just nu. Moms debiteras. Försök igen om en stund.",
      ownNumber: "Det här är butikens eget momsnummer. Moms debiteras.",
      notEu: "Bara momsnummer från EU-länder kan användas här. Moms debiteras.",
    },
    problem: {
      empty: "Skriv in ett momsnummer.",
      noCountry: "Börja numret med landskod, till exempel DE.",
      characters: "Momsnumret får bara innehålla bokstäver och siffror.",
      shape: "Momsnumret ser inte rätt ut. Kontrollera det och försök igen.",
      company: "Fyll i företagsnamnet först.",
      companyNumber: "Kontrollera organisationsnumret först.",
      noCart: "Varukorgen hittades inte. Ladda om sidan.",
      unsaved: "Kontrollera momsnumret, eller töm fältet för att betala med moms.",
    },
    basketService: "Momsnummer kan inte användas när varukorgen har en bokning, en vistelse eller en uthyrning. Moms debiteras.",
    basketSubscription: "Momsnummer kan inte användas när varukorgen har en prenumeration. Moms debiteras.",
    vatAtRate: (rate) => `varav moms ${ratePercent(rate)}`,
    // legal: needs review
    iossPending: (number) => `Den här beställningen gäller IOSS (${number}). Momsen tas ut när beställningen är betald.`,
  },
  da: {
    label: "Momsnummer (EU)",
    help: "Virksomhedens momsnummer i EU, for eksempel DE123456789. Er det gyldigt i det land, varerne sendes til, opkræves der ikke moms, og I afregner den selv i jeres eget land (omvendt betalingspligt).",
    check: "Tjek nummeret",
    checking: "Tjekker …",
    vatLineReverse: "Moms (omvendt betalingspligt)",
    outcome: {
      accepted: "Momsnummeret er godkendt. Der opkræves ikke moms (omvendt betalingspligt).",
      nothingTaxable: "Momsnummeret er godkendt. Disse varer har ingen moms.",
      otherCountry: (n, d) => `Nummeret gælder ${n}, men varerne sendes til ${d}. Der opkræves moms.`,
      invalid: "Momsnummeret blev ikke godkendt. Der opkræves moms.",
      unavailable: "Momsnummeret kunne ikke tjekkes lige nu. Der opkræves moms. Prøv igen om lidt.",
      ownNumber: "Det er butikkens eget momsnummer. Der opkræves moms.",
      notEu: "Kun momsnumre fra EU-lande kan bruges her. Der opkræves moms.",
    },
    problem: {
      empty: "Skriv et momsnummer.",
      noCountry: "Start nummeret med landekode, for eksempel DE.",
      characters: "Momsnummeret må kun indeholde bogstaver og tal.",
      shape: "Momsnummeret ser ikke rigtigt ud. Tjek det og prøv igen.",
      company: "Udfyld firmanavnet først.",
      companyNumber: "Tjek organisationsnummeret først.",
      noCart: "Kurven blev ikke fundet. Indlæs siden igen.",
      unsaved: "Tjek momsnummeret, eller ryd feltet for at betale med moms.",
    },
    basketService: "Momsnummer kan ikke bruges, når kurven har en tid, et ophold eller en udlejning. Der opkræves moms.",
    basketSubscription: "Momsnummer kan ikke bruges, når kurven har et abonnement. Der opkræves moms.",
    vatAtRate: (rate) => `heraf moms ${ratePercent(rate)}`,
    // legal: needs review
    iossPending: (number) => `Denne bestilling hører under IOSS (${number}). Momsen opkræves, når bestillingen er betalt.`,
  },
  en: {
    label: "VAT number (EU)",
    help: "The company's EU VAT number, for example DE123456789. If it is valid in the country the goods are sent to, VAT is not charged and you account for it yourselves in your own country (reverse charge).",
    check: "Check number",
    checking: "Checking …",
    vatLineReverse: "VAT (reverse charge)",
    outcome: {
      accepted: "The VAT number was accepted. VAT is not charged (reverse charge).",
      nothingTaxable: "The VAT number was accepted. These goods carry no VAT.",
      otherCountry: (n, d) => `The number is for ${n}, but the goods go to ${d}. VAT is charged.`,
      invalid: "This VAT number was not accepted. VAT is charged.",
      unavailable: "The VAT number could not be checked right now. VAT is charged. Try again in a moment.",
      ownNumber: "This is the store's own VAT number. VAT is charged.",
      notEu: "Only VAT numbers from EU member states can be used here. VAT is charged.",
    },
    problem: {
      empty: "Enter a VAT number.",
      noCountry: "Start the number with a country code, for example DE.",
      characters: "A VAT number can only hold letters and digits.",
      shape: "The VAT number does not look right. Check it and try again.",
      company: "Enter the company name first.",
      companyNumber: "Check the organisation number first.",
      noCart: "The cart was not found. Reload the page.",
      unsaved: "Check the VAT number, or clear the field to pay with VAT.",
    },
    basketService: "A VAT number cannot be used when the cart has an appointment, a stay or a rental. VAT is charged.",
    basketSubscription: "A VAT number cannot be used when the cart has a subscription. VAT is charged.",
    vatAtRate: (rate) => `of which VAT ${ratePercent(rate)}`,
    // legal: needs review
    iossPending: (number) => `This order falls under IOSS (${number}). The VAT is collected when the order has been paid.`,
  },
};

/** The VAT wording of the shopper's pages in a language: nb, sv, da or en by hand, English for every other language. */
export function vatText(lang: string): VatText {
  const own = lang in TEXT ? TEXT[lang as keyof typeof TEXT] : TEXT.en;
  const email = vatEmailText(lang);
  return {
    ...own,
    reliefRow: email.reliefRow,
    reverseCharge: email.reverseCharge,
    sellerNumber: email.sellerNumber,
    buyerNumber: email.buyerNumber,
    ioss: email.ioss,
    importNotice: email.importNotice,
  };
}

/** What the cart or the order knows of a typed number: the reason the decision came to and the number. */
export type VatNumberFacts = {
  reason: string;
  buyerVatNumber: string | null;
  /** The country of the number's prefix and of the market, already named in the shopper's language. */
  numberCountry: string;
  deliveryCountry: string;
};

export type VatNumberMessage = { text: string; tone: "ok" | "warn" };

/**
 * The sentence under the VAT number field: what became of the number the shopper typed, by the reason the decision gave.
 * Null when no number is on the cart, or when the reason has nothing to do with the number (the field is not drawn for
 * those). Never says the VAT is exempt unless reverse charge applies, and says plainly when VIES could not answer.
 */
export function vatNumberMessage(facts: VatNumberFacts, text: VatText): VatNumberMessage | null {
  if (!facts.buyerVatNumber) return null;
  const o = text.outcome;
  switch (facts.reason) {
    case "reverse_charge":
      return { text: o.accepted, tone: "ok" };
    case "nothing_taxable":
      return { text: o.nothingTaxable, tone: "ok" };
    case "number_other_country":
      return { text: o.otherCountry(facts.numberCountry, facts.deliveryCountry), tone: "warn" };
    case "number_invalid":
      return { text: o.invalid, tone: "warn" };
    case "number_unavailable":
    case "number_stale":
      return { text: o.unavailable, tone: "warn" };
    case "own_number":
      return { text: o.ownNumber, tone: "warn" };
    case "number_not_eu":
      return { text: o.notEu, tone: "warn" };
    default:
      return null;
  }
}

/** The text for a problem the action named (`vatNumberAction()`'s outcome), or null when the outcome is not a problem. */
export function vatProblemText(outcome: string, text: VatText): string | null {
  const p = text.problem;
  switch (outcome) {
    case "empty":
      return p.empty;
    case "no_country":
      return p.noCountry;
    case "characters":
      return p.characters;
    case "shape":
      return p.shape;
    case "company":
      return p.company;
    case "company_number":
    case "no_company":
      return p.companyNumber;
    case "no_cart":
      return p.noCart;
    default:
      return null;
  }
}

/** A country's name in a language, as the shopper reads it; the code itself when the runtime does not know it. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every outcome of the action that is a problem, with its text: what the client holds to word an answer. */
export const VAT_PROBLEM_OUTCOMES = ["empty", "no_country", "characters", "shape", "company", "company_number", "no_company", "no_cart"] as const;

export function vatProblemTexts(text: VatText): Record<string, string> {
  return Object.fromEntries(VAT_PROBLEM_OUTCOMES.map((outcome) => [outcome, vatProblemText(outcome, text) ?? ""]));
}
