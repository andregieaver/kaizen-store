/**
 * EU VAT numbers as people type them (D157, docs/wave-1a-tax.md section 4.3): normalised to the form VIES takes (the
 * country prefix and the number's characters), with a shape check that only catches obvious typos. The authority is VIES
 * (`src/lib/vies.ts`); a shape check here never decides that a number is valid.
 *
 * Needs review by an accountant: the per-country patterns below are the formats the Commission publishes for VIES
 * (https://ec.europa.eu/taxation_customs/vies/), written from the table as known, not re-read on 2026-10-03. A country's
 * pattern is deliberately a little wider than the strictest reading so that it never rejects what VIES might accept;
 * a country with no pattern here would fall back to `LOOSE_BODY`.
 */

/** The EU member states' countries (ISO 3166-1 alpha-2): the VAT area for reverse charge. Norway and the UK are not in it. */
export const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const; // prettier-ignore

const EU_SET: ReadonlySet<string> = new Set(EU_COUNTRIES);

/** Whether a country is an EU member state. */
export const isEuMemberCountry = (country: string | null | undefined): boolean =>
  EU_SET.has((country ?? "").trim().toUpperCase());

/** The prefix a country's VAT numbers carry: its code, but Greece's is `EL`. */
export const vatPrefixOf = (country: string): string => {
  const code = country.trim().toUpperCase();
  return code === "GR" ? "EL" : code;
};

/** The country a VAT prefix belongs to (`EL` is Greece). */
export const countryOfVatPrefix = (prefix: string): string => {
  const code = prefix.trim().toUpperCase();
  return code === "EL" ? "GR" : code;
};

/** The prefixes of the 27 member states, as VIES takes them (Greece `EL`). */
export const EU_VAT_PREFIXES: readonly string[] = EU_COUNTRIES.map(vatPrefixOf);

/**
 * Prefixes that are recognised when typed but are not EU member states for reverse charge: Northern Ireland (`XI`, goods
 * only and not accepted in 1a), Norway, the UK and Switzerland.
 */
export const OTHER_VAT_PREFIXES: readonly string[] = ["XI", "NO", "GB", "CH"];

/** What VIES takes for the number itself (its swagger file): 2 to 12 of `[0-9A-Za-z+*.]`. */
export const LOOSE_BODY = /^[0-9A-Z+*.]{2,12}$/;

/** The shape of the number after its prefix, by prefix. Wider than the strictest reading on purpose. */
const BODY_PATTERNS: Record<string, RegExp> = {
  AT: /^U[0-9]{8}$/,
  BE: /^[01]?[0-9]{9}$/,
  BG: /^[0-9]{9,10}$/,
  CY: /^[0-9]{8}[A-Z]$/,
  CZ: /^[0-9]{8,10}$/,
  DE: /^[0-9]{9}$/,
  DK: /^[0-9]{8}$/,
  EE: /^[0-9]{9}$/,
  EL: /^[0-9]{9}$/,
  ES: /^[0-9A-Z][0-9]{7}[0-9A-Z]$/,
  FI: /^[0-9]{8}$/,
  FR: /^[0-9A-Z]{2}[0-9]{9}$/,
  HR: /^[0-9]{11}$/,
  HU: /^[0-9]{8}$/,
  IE: /^([0-9][0-9A-Z+*][0-9]{5}[A-Z]|[0-9]{7}[A-W][A-I]?)$/,
  IT: /^[0-9]{11}$/,
  LT: /^([0-9]{9}|[0-9]{12})$/,
  LU: /^[0-9]{8}$/,
  LV: /^[0-9]{11}$/,
  MT: /^[0-9]{8}$/,
  NL: /^[0-9]{9}B[0-9]{2}$/,
  PL: /^[0-9]{10}$/,
  PT: /^[0-9]{9}$/,
  RO: /^[0-9]{2,10}$/,
  SE: /^[0-9]{12}$/,
  SI: /^[0-9]{8}$/,
  SK: /^[0-9]{10}$/,
};

export type VatNumberProblem =
  /** Nothing typed. */
  | "empty"
  /** No prefix typed and no country to take it from. */
  | "no_country"
  /** The characters are not a VAT number's (letters, digits and `+ * .` only, 2 to 12 after the prefix). */
  | "characters"
  /** The number's shape is not that of its country's. */
  | "shape";

export type NormalisedVatNumber =
  | {
      ok: true;
      /** The prefix and the number, as kept and sent: `SE556677889901`, `EL123456789`. */
      number: string;
      /** `SE`, `EL`. */
      prefix: string;
      /** The number without its prefix. */
      body: string;
      /** The country the prefix belongs to (`GR` for `EL`). */
      country: string;
      /** Whether that country is an EU member state (reverse charge is only ever for these). */
      inEu: boolean;
    }
  | { ok: false; problem: VatNumberProblem };

const SEPARATORS = /[\s .\-/]/g;

/**
 * A typed VAT number made into the prefix and the number, or the problem with it. The prefix may be typed (any case,
 * with spaces, dots or dashes, Greece as `EL` or `GR`) or taken from `country` (the country the number is for, such as
 * the delivery country). Dots are separators (VIES numbers hold none in practice). Pure and total: it never throws.
 */
export function normaliseVatNumber(country: string | null | undefined, input: string): NormalisedVatNumber {
  const text = (input ?? "").toUpperCase().replace(SEPARATORS, "");
  if (text === "") return { ok: false, problem: "empty" };
  if (!/^[0-9A-Z+*]+$/.test(text)) return { ok: false, problem: "characters" };

  // A typed prefix: two letters that name a country. `GR` is Greece's code and `EL` its prefix.
  const head = text.slice(0, 2);
  const known = new Set([...EU_VAT_PREFIXES, ...OTHER_VAT_PREFIXES, "GR"]);
  let prefix: string;
  let body: string;
  if (/^[A-Z]{2}$/.test(head) && known.has(head) && text.length > 2) {
    prefix = head === "GR" ? "EL" : head;
    body = text.slice(2);
  } else {
    const hint = country?.trim();
    if (!hint) return { ok: false, problem: "no_country" };
    prefix = vatPrefixOf(hint);
    body = text;
  }

  if (!LOOSE_BODY.test(body)) return { ok: false, problem: "characters" };
  const pattern = BODY_PATTERNS[prefix];
  if (pattern && !pattern.test(body)) return { ok: false, problem: "shape" };

  const countryCode = countryOfVatPrefix(prefix);
  return { ok: true, number: `${prefix}${body}`, prefix, body, country: countryCode, inEu: isEuMemberCountry(countryCode) };
}

/** The normalised form kept in the database (`^[A-Z]{2}[0-9A-Z+*.]{2,12}$`). */
export const VAT_NUMBER_STORED = /^[A-Z]{2}[0-9A-Z+*.]{2,12}$/;

/** A number as people read it: the prefix, a space, the rest. */
export function formatVatNumber(number: string): string {
  return VAT_NUMBER_STORED.test(number) ? `${number.slice(0, 2)} ${number.slice(2)}` : number;
}

/** Whether two typed or stored numbers are the same number (prefix and body, ignoring spaces and case). */
export function sameVatNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const strip = (x: string) => x.toUpperCase().replace(SEPARATORS, "");
  return strip(a) === strip(b);
}

const PROBLEM_TEXT: Record<VatNumberProblem, string> = {
  empty: "Enter the VAT number.",
  no_country: "Start the VAT number with the two-letter country code.",
  characters: "A VAT number has only letters and digits.",
  shape: "That does not look like a VAT number for its country.",
};

/** A plain English sentence for a problem (the shopper's own words are in `i18n.ts`). */
export const vatNumberProblemText = (problem: VatNumberProblem): string => PROBLEM_TEXT[problem];
