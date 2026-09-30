/**
 * Brønnøysundregistrene's open Enhetsregisteret (`data.brreg.no`, NLOD licence, no
 * key): a Norwegian company's registered name, address and VAT registration from its
 * organisation number, or a search by name. Pure parts only: checking a number,
 * reading the answer into what the client form fills in, and the VAT number a
 * company may state. The calls are in `src/server/brreg.ts`. Nothing here reads the
 * answer as anything but text: a registry name is data, never markup.
 */

const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];

/** The nine digits of an organisation number from what was typed ("923 609 016", "NO923609016MVA"), or null. */
export function organisationDigits(value: string): string | null {
  const stripped = value
    .trim()
    .toUpperCase()
    .replace(/^NO/, "")
    .replace(/MVA$/, "")
    .replace(/[\s.\-]/g, "");
  return /^\d{9}$/.test(stripped) ? stripped : null;
}

/** Whether nine digits are a real organisation number: the last digit is a mod-11 check digit. */
export function isOrganisationNumber(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
  const check = 11 - (sum % 11);
  return check !== 10 && (check === 11 ? 0 : check) === Number(digits[8]);
}

/** "923609016" as "923 609 016", the way Norwegians write it. */
export function formatOrganisationNumber(digits: string): string {
  return /^\d{9}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : digits;
}

/** What the person typed: nothing to look up, a number to look up, or a name to search for. */
export type BrregQuery =
  | { kind: "empty" }
  | { kind: "number"; digits: string; valid: boolean }
  | { kind: "name"; text: string };

export const BRREG_NAME_MIN = 2;
export const BRREG_NAME_MAX = 100;

export function classifyQuery(input: string): BrregQuery {
  const text = input.trim().replace(/\s+/g, " ");
  if (text === "") return { kind: "empty" };
  const digits = organisationDigits(text);
  if (digits) return { kind: "number", digits, valid: isOrganisationNumber(digits) };
  // Only digits and spaces that are not nine digits is a mistyped number, not a name.
  if (/^[\d\s.\-]+$/.test(text)) return { kind: "number", digits: text.replace(/\D/g, ""), valid: false };
  return { kind: "name", text: text.slice(0, BRREG_NAME_MAX) };
}

export type BrregAddress = {
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
};

/** What the registry says about one company, in the shape the client form takes. */
export type BrregCompany = {
  organisationNumber: string;
  /** The registered name, as the registry writes it (often in capitals). */
  legalName: string;
  /** The same in readable case, for the name the person calls them by. */
  name: string;
  organisationForm: string | null;
  organisationFormName: string | null;
  address: BrregAddress | null;
  vatRegistered: boolean;
  /** `NO923609016MVA`, only for a company registered in the VAT register. */
  vatNumber: string | null;
  /** The document language its own form suggests. */
  locale: "nb" | "en";
  website: string | null;
  /** Things to know before invoicing them; empty for a company in good standing. */
  warnings: string[];
};

/** One hit of a name search. */
export type BrregHit = {
  organisationNumber: string;
  legalName: string;
  organisationForm: string | null;
  /** Where it is: the town of the business address. */
  place: string | null;
};

const ORG_FORMS = new Set(["AS", "ASA", "ENK", "DA", "ANS", "SA", "NUF", "KS", "BA", "SE", "FLI", "STI", "IKS", "AL"]);

/**
 * Registry names are in capitals ("DET NORSKE KAFFEHUS AS"): "Det Norske Kaffehus AS" reads as a name. Only a name
 * that is all capitals is changed; mixed case is left as written, and legal forms stay in capitals.
 */
export function readableName(registered: string): string {
  const name = registered.trim().replace(/\s+/g, " ");
  if (name === "" || name !== name.toUpperCase() || name === name.toLowerCase()) return name;
  return name
    .split(" ")
    .map((word) => {
      if (ORG_FORMS.has(word)) return word;
      // Keep short all-capital words with digits or dots (initials, "3M", "A.S.") as they are.
      if (/[\d.]/.test(word) || word.length === 1) return word;
      return word
        .toLowerCase()
        .replace(/(^|[-'/])([a-zæøåéèü])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
    })
    .join(" ");
}

/** The VAT number a Norwegian company states: `NO` + the number + `MVA`, and only when it is in the VAT register. */
export function norwegianVatNumber(digits: string, registered: boolean): string | null {
  return registered && isOrganisationNumber(digits) ? `NO${digits}MVA` : null;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function readAddress(value: unknown): BrregAddress | null {
  const raw = asObject(value);
  if (!raw) return null;
  const lines = (Array.isArray(raw.adresse) ? raw.adresse : []).map(asText).filter(Boolean);
  const postalCode = asText(raw.postnummer);
  const city = readableName(asText(raw.poststed));
  if (lines.length === 0 && postalCode === "" && city === "") return null;
  return {
    line1: lines[0] ?? "",
    line2: lines.slice(1).join(", "),
    postalCode,
    city,
  };
}

/**
 * One `/enheter/{orgnr}` answer as a company, or null when it is not one (a bad shape, no number). A deleted unit
 * comes back with few fields: it is still returned, with a warning, so the person can see why.
 */
export function parseCompany(json: unknown): BrregCompany | null {
  const raw = asObject(json);
  if (!raw) return null;
  const digits = asText(raw.organisasjonsnummer);
  if (!/^\d{9}$/.test(digits)) return null;
  const legalName = asText(raw.navn);
  if (legalName === "") return null;

  const form = asObject(raw.organisasjonsform);
  const vatRegistered = raw.registrertIMvaregisteret === true;
  const warnings: string[] = [];
  if (asText(raw.slettedato) !== "") warnings.push("This company has been deleted from the register.");
  if (raw.konkurs === true) warnings.push("This company is bankrupt.");
  if (raw.underAvvikling === true) warnings.push("This company is being wound up.");
  if (raw.underTvangsavviklingEllerTvangsopplosning === true)
    warnings.push("This company is being forcibly dissolved.");

  const site = asText(raw.hjemmeside);
  return {
    organisationNumber: digits,
    legalName,
    name: readableName(legalName),
    organisationForm: asText(form?.kode) || null,
    organisationFormName: asText(form?.beskrivelse) || null,
    // The business address is where invoices belong; the postal address is often a PO box.
    address: readAddress(raw.forretningsadresse) ?? readAddress(raw.postadresse),
    vatRegistered,
    vatNumber: norwegianVatNumber(digits, vatRegistered),
    locale: "nb",
    website: /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(site) || /^https?:\/\//i.test(site) ? site : null,
    warnings,
  };
}

/** A search answer (`{ _embedded: { enheter: [...] } }`) as hits; nothing found has no `_embedded`. */
export function parseHits(json: unknown, limit = 8): BrregHit[] {
  const raw = asObject(json);
  const embedded = asObject(raw?._embedded);
  const units = Array.isArray(embedded?.enheter) ? embedded.enheter : [];
  const hits: BrregHit[] = [];
  for (const unit of units) {
    const item = asObject(unit);
    const digits = asText(item?.organisasjonsnummer);
    const legalName = asText(item?.navn);
    if (!item || !/^\d{9}$/.test(digits) || legalName === "") continue;
    const address = asObject(item.forretningsadresse) ?? asObject(item.postadresse);
    hits.push({
      organisationNumber: digits,
      legalName,
      organisationForm: asText(asObject(item.organisasjonsform)?.kode) || null,
      place: readableName(asText(address?.poststed)) || null,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Fills in the form: what to write into each field for a company, and what to leave alone. */
export type ClientPrefill = {
  /** Only when the person has not named the client yet. */
  name: string;
  legalName: string;
  organisationNumber: string;
  vatNumber: string;
  country: "NO";
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  locale: "nb" | "en";
};

export function clientPrefill(company: BrregCompany): ClientPrefill {
  return {
    name: company.name,
    legalName: company.legalName,
    organisationNumber: company.organisationNumber,
    vatNumber: company.vatNumber ?? "",
    country: "NO",
    line1: company.address?.line1 ?? "",
    line2: company.address?.line2 ?? "",
    postalCode: company.address?.postalCode ?? "",
    city: company.address?.city ?? "",
    locale: company.locale,
  };
}
