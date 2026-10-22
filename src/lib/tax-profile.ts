/**
 * A store's tax profile (D157, docs/wave-1a-tax.md sections 2.2 and 3.4): whether it is registered for VAT and under
 * which number, where it sends goods from, its OSS and IOSS registrations. Pure: the type, the checking of what an owner
 * types (shared by the browser and the server), and the lines that say what is on and what is missing. The table is
 * `commerce.store_tax_profile`; its numbers are never copied with a store.
 *
 * Nothing here is legal or tax advice; the admin's English warnings (`TAX_WARNINGS`) are written for an accountant's
 * eyes and *need review*.
 */
import { taxEn, type TaxMessages } from "./admin-messages/tax.en";
import { organisationNumber } from "./b2b";
import { IOSS_NUMBER, normaliseIossNumber, normaliseOssNumber } from "./ioss";
import type { VatTreatmentInput } from "./vat-treatment";
import { isEuMemberCountry, normaliseVatNumber, vatPrefixOf } from "./vat-number";

export const OSS_SCHEMES = ["none", "union", "non_union"] as const;
export type OssScheme = (typeof OSS_SCHEMES)[number];

export const OSS_SCHEME_LABELS: Record<OssScheme, { label: string; hint: string }> = taxEn.schemes;

/** What the table holds, as the server reads it (dates as `yyyy-mm-dd`, times as ISO strings). */
export type TaxProfile = {
  vatRegistered: boolean;
  /** Normalised with its country prefix. */
  vatNumber: string | null;
  vatNumberCheckId: string | null;
  vatNumberCheckedAt: string | null;
  vatNumberValid: boolean | null;
  dispatchCountry: string | null;
  ossScheme: OssScheme;
  ossMemberState: string | null;
  ossNumber: string | null;
  ossRegisteredOn: string | null;
  iossNumber: string | null;
  iossIntermediary: string | null;
  iossMarkets: string[];
  iossRegisteredOn: string | null;
};

/** What a store without a row has. */
export const DEFAULT_TAX_PROFILE: TaxProfile = {
  vatRegistered: false,
  vatNumber: null,
  vatNumberCheckId: null,
  vatNumberCheckedAt: null,
  vatNumberValid: null,
  dispatchCountry: null,
  ossScheme: "none",
  ossMemberState: null,
  ossNumber: null,
  ossRegisteredOn: null,
  iossNumber: null,
  iossIntermediary: null,
  iossMarkets: [],
  iossRegisteredOn: null,
};

/** Where goods are sent from: the profile's country, else the store's own. */
export const effectiveDispatch = (profile: Pick<TaxProfile, "dispatchCountry">, storeCountry: string | null): string | null =>
  profile.dispatchCountry ?? storeCountry;

/** The seller's side of `vatTreatment()`'s input. */
export function sellerFacts(profile: TaxProfile, storeCountry: string | null): VatTreatmentInput["seller"] {
  const dispatch = effectiveDispatch(profile, storeCountry);
  return {
    country: storeCountry,
    inEu: isEuMemberCountry(storeCountry),
    registered: profile.vatRegistered && profile.vatNumber !== null,
    numberValid: profile.vatNumberValid === true,
    number: profile.vatNumber,
    dispatchCountry: dispatch,
    dispatchInEu: isEuMemberCountry(dispatch),
  };
}

// ---------------------------------------------------------------------------
// What an owner types
// ---------------------------------------------------------------------------

export type TaxProfileForm = {
  vatRegistered: boolean;
  vatNumber: string;
  dispatchCountry: string;
  ossScheme: OssScheme;
  ossMemberState: string;
  ossNumber: string;
  ossRegisteredOn: string;
  iossNumber: string;
  iossIntermediary: string;
  iossMarkets: string[];
  iossRegisteredOn: string;
};

export const TAX_PROFILE_FIELDS = [
  "vatRegistered",
  "vatNumber",
  "dispatchCountry",
  "ossScheme",
  "ossMemberState",
  "ossNumber",
  "ossRegisteredOn",
  "iossNumber",
  "iossIntermediary",
  "iossMarkets",
  "iossRegisteredOn",
] as const;
export type TaxProfileField = (typeof TAX_PROFILE_FIELDS)[number];

/** The form's starting values from the saved profile. */
export const formOf = (profile: TaxProfile): TaxProfileForm => ({
  vatRegistered: profile.vatRegistered,
  vatNumber: profile.vatNumber ?? "",
  dispatchCountry: profile.dispatchCountry ?? "",
  ossScheme: profile.ossScheme,
  ossMemberState: profile.ossMemberState ?? "",
  ossNumber: profile.ossNumber ?? "",
  ossRegisteredOn: profile.ossRegisteredOn ?? "",
  iossNumber: profile.iossNumber ?? "",
  iossIntermediary: profile.iossIntermediary ?? "",
  iossMarkets: [...profile.iossMarkets],
  iossRegisteredOn: profile.iossRegisteredOn ?? "",
});

/** What is written to the table (without the check columns, which only a check changes). */
export type TaxProfileValues = Pick<
  TaxProfile,
  | "vatRegistered"
  | "vatNumber"
  | "dispatchCountry"
  | "ossScheme"
  | "ossMemberState"
  | "ossNumber"
  | "ossRegisteredOn"
  | "iossNumber"
  | "iossIntermediary"
  | "iossMarkets"
  | "iossRegisteredOn"
>;

export type TaxProfileResult =
  | { ok: true; values: TaxProfileValues }
  | { ok: false; errors: Partial<Record<TaxProfileField, string>> };

const COUNTRY = /^[A-Z]{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (text: string): boolean => {
  if (!DATE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
};

/**
 * The seller's own VAT number as typed, for a store in `storeCountry`: an EU store's number carries its country's prefix
 * (Greece `EL`); a Norwegian store's is nine digits and `MVA` (checked with the organisation number's own check digit).
 */
export function normaliseSellerVatNumber(storeCountry: string | null, input: string): { ok: true; number: string } | { ok: false; error: string } {
  const country = storeCountry?.toUpperCase() ?? null;
  if (country === "NO") {
    const digits = input.toUpperCase().replace(/[\s.\-]/g, "").replace(/^NO/, "").replace(/MVA$/, "");
    const checked = /^\d{9}$/.test(digits) ? organisationNumber("NO", digits) : null;
    return checked ? { ok: true, number: `NO${digits}MVA` } : { ok: false, error: "A Norwegian VAT number is the nine-digit organisation number followed by MVA." };
  }
  const normalised = normaliseVatNumber(country, input);
  if (!normalised.ok) {
    return {
      ok: false,
      error:
        normalised.problem === "shape"
          ? "That does not look like a VAT number for the store's country."
          : normalised.problem === "characters"
            ? "A VAT number has only letters and digits."
            : "Enter the VAT number, starting with the country code.",
    };
  }
  if (country && normalised.prefix !== vatPrefixOf(country)) {
    return { ok: false, error: `The VAT number must be one of the store's own country (it starts with ${vatPrefixOf(country)}).` };
  }
  return { ok: true, number: normalised.number };
}

/**
 * Checks what an owner typed and makes it what is stored, or says what is wrong per field (plain English: the admin is
 * English only). Fields that do not belong to the chosen scheme are cleared rather than refused. The rules are the
 * database's own (`store_tax_profile` checks and trigger), said before the database has to.
 */
export function parseTaxProfile(form: TaxProfileForm, storeCountry: string | null): TaxProfileResult {
  const errors: Partial<Record<TaxProfileField, string>> = {};
  const values: TaxProfileValues = {
    vatRegistered: false,
    vatNumber: null,
    dispatchCountry: null,
    ossScheme: "none",
    ossMemberState: null,
    ossNumber: null,
    ossRegisteredOn: null,
    iossNumber: null,
    iossIntermediary: null,
    iossMarkets: [],
    iossRegisteredOn: null,
  };

  values.vatRegistered = form.vatRegistered === true;

  const vat = form.vatNumber.trim();
  if (vat !== "") {
    const result = normaliseSellerVatNumber(storeCountry, vat);
    if (result.ok) values.vatNumber = result.number;
    else errors.vatNumber = result.error;
  }

  const dispatch = form.dispatchCountry.trim().toUpperCase();
  if (dispatch !== "") {
    if (COUNTRY.test(dispatch)) values.dispatchCountry = dispatch;
    else errors.dispatchCountry = "Use a two-letter country code, such as NO or CN.";
  }

  values.ossScheme = OSS_SCHEMES.includes(form.ossScheme) ? form.ossScheme : "none";
  const member = form.ossMemberState.trim().toUpperCase();
  const ossNumber = form.ossNumber.trim();
  if (values.ossScheme === "union") {
    if (!isEuMemberCountry(member)) errors.ossMemberState = "The Union scheme is registered in an EU member state. Choose it.";
    else values.ossMemberState = member;
    if (ossNumber !== "") errors.ossNumber = "The Union scheme has no number of its own: it is declared under the VAT number.";
  } else if (values.ossScheme === "non_union") {
    if (member !== "") {
      if (COUNTRY.test(member)) values.ossMemberState = member;
      else errors.ossMemberState = "Use a two-letter country code.";
    }
    if (ossNumber !== "") {
      const normalised = normaliseOssNumber(ossNumber);
      if (normalised) values.ossNumber = normalised;
      else errors.ossNumber = "A non-Union OSS number is EU and nine digits.";
    }
  }
  if (values.ossScheme !== "none") {
    const on = form.ossRegisteredOn.trim();
    if (on !== "") {
      if (validDate(on)) values.ossRegisteredOn = on;
      else errors.ossRegisteredOn = "Use a date as year-month-day.";
    }
  }

  const ioss = form.iossNumber.trim();
  if (ioss !== "") {
    const normalised = normaliseIossNumber(ioss);
    if (normalised) values.iossNumber = normalised;
    else errors.iossNumber = "An IOSS number is IM and ten digits.";
  }
  const intermediary = form.iossIntermediary.trim();
  if (intermediary !== "") {
    if (intermediary.length > 120) errors.iossIntermediary = "At most 120 characters.";
    else values.iossIntermediary = intermediary;
  }
  const markets = [...new Set(form.iossMarkets.map((m) => m.trim().toUpperCase()).filter((m) => m !== ""))];
  const bad = markets.filter((m) => !isEuMemberCountry(m));
  if (bad.length > 0) errors.iossMarkets = `IOSS applies to EU countries only (not ${bad.join(", ")}).`;
  else values.iossMarkets = markets;
  const iossOn = form.iossRegisteredOn.trim();
  if (iossOn !== "") {
    if (validDate(iossOn)) values.iossRegisteredOn = iossOn;
    else errors.iossRegisteredOn = "Use a date as year-month-day.";
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** Whether saving `next` changes the number, which clears its check (the three check columns). */
export const vatNumberChanged = (previous: TaxProfile, next: Pick<TaxProfileValues, "vatNumber">): boolean =>
  previous.vatNumber !== next.vatNumber;

// ---------------------------------------------------------------------------
// What is on, what is missing
// ---------------------------------------------------------------------------

export type ReadinessKey = "vat" | "reverse_charge" | "oss" | "ioss";

export type ReadinessLine = {
  key: ReadinessKey;
  on: boolean;
  /** What is missing, in plain words (empty when on). */
  needs: string[];
  /** The whole line: "Reverse charge: off. Needs: a VAT number that has been checked valid." */
  text: string;
};

const line = (w: TaxMessages["readiness"], key: ReadinessKey, needs: string[]): ReadinessLine => ({
  key,
  on: needs.length === 0,
  needs,
  text:
    needs.length === 0
      ? w.lineOn.replace("{name}", w.names[key]).replace("{text}", w.onText[key])
      : w.lineOff.replace("{name}", w.names[key]).replace("{needs}", needs.join(w.joiner)),
});

/** One line per thing the tax screen says is on or off, under the form, in `words` (English, as the AI manager reads it, unless given). */
export function readiness(profile: TaxProfile, storeCountry: string | null, words: TaxMessages["readiness"] = taxEn.readiness): ReadinessLine[] {
  const lines: ReadinessLine[] = [];
  const n = words.needs;

  const vatNeeds: string[] = [];
  if (!profile.vatRegistered) vatNeeds.push(n.vatSwitch);
  else if (!profile.vatNumber) vatNeeds.push(n.vatNumber);
  lines.push(line(words, "vat", vatNeeds));

  const reverseNeeds: string[] = [];
  if (!isEuMemberCountry(storeCountry)) {
    reverseNeeds.push(n.euStore);
  } else {
    if (!profile.vatRegistered) reverseNeeds.push(n.registration);
    if (!profile.vatNumber) reverseNeeds.push(n.vatNumber);
    else if (profile.vatNumberValid !== true) reverseNeeds.push(n.checkedNumber);
    // Goods sent from outside the EU are an import, not a supply to another member state (Directive 2006/112/EC Art. 138).
    if (!isEuMemberCountry(effectiveDispatch(profile, storeCountry))) {
      reverseNeeds.push(n.euDispatch);
    }
  }
  lines.push(line(words, "reverse_charge", reverseNeeds));

  const ossNeeds: string[] = [];
  if (profile.ossScheme === "none") ossNeeds.push(n.scheme);
  else if (profile.ossScheme === "union" && !profile.ossMemberState) ossNeeds.push(n.memberState);
  else if (profile.ossScheme === "non_union" && !profile.ossNumber) ossNeeds.push(n.ossNumber);
  lines.push(line(words, "oss", ossNeeds));

  const iossNeeds: string[] = [];
  if (!profile.iossNumber) iossNeeds.push(n.iossNumber);
  if (profile.iossMarkets.length === 0) iossNeeds.push(n.iossMarkets);
  if (isEuMemberCountry(effectiveDispatch(profile, storeCountry)) && profile.iossNumber) {
    iossNeeds.push(n.outsideEu);
  }
  lines.push(line(words, "ioss", iossNeeds));
  return lines;
}

export type CheckupFinding = { code: string; message: string };

/** What the store checkup reports about the profile. */
export function checkupFindings(profile: TaxProfile): CheckupFinding[] {
  const found: CheckupFinding[] = [];
  if (profile.vatRegistered && !profile.vatNumber) {
    found.push({ code: "vat_registered_without_number", message: "The store is registered for VAT but has no VAT number." });
  }
  if (profile.vatNumber && profile.vatNumberValid !== true) {
    found.push({ code: "vat_number_not_valid", message: "The VAT number has not been checked valid." });
  }
  if (profile.iossMarkets.length > 0 && !profile.iossNumber) {
    found.push({ code: "ioss_markets_without_number", message: "IOSS markets are chosen but there is no IOSS number." });
  }
  if (profile.iossNumber && IOSS_NUMBER.test(profile.iossNumber) && profile.iossMarkets.length === 0) {
    found.push({ code: "ioss_number_without_markets", message: "There is an IOSS number but no market it applies to." });
  }
  if ((profile.ossScheme === "union" && !profile.ossMemberState) || (profile.ossScheme === "non_union" && !profile.ossNumber)) {
    found.push({ code: "oss_incomplete", message: "OSS is selected without its details." });
  }
  return found;
}

/** The warnings the tax screen shows, in plain English for an accountant's eyes. Needs review. */
export const TAX_WARNINGS: readonly string[] = taxEn.warnings.items;
