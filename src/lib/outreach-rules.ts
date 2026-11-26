/**
 * The country's rule, in code (email plan P5.3, D906): whether the outreach tool may write a first marketing email, and to what, per
 * country, from `docs/outreach-rules.md` as the owner left it in Legal reviews on 26 November 2026. Pure.
 *
 * - **A rule is the owner's position until a lawyer reads it.** Each row holds the route the owner proposes and `legalReading`, null until
 *   a lawyer signs the row in Legal reviews. A row without a lawyer's reading never lets anything be sent (`outreachGate()`), whatever it
 *   proposes: the owner asked for sending to stay off until the rules, the controller roles, the privacy documents, the suppression
 *   procedures and the safeguards are approved.
 * - **The country is not enough** (the owner's view, overall 2): the gate also asks what the recipient is (a limited company or the like, a
 *   sole trader, a person) and what the address is (a company's general enquiry address, or one that names a person). Only a legal entity's
 *   general address is ever a candidate; a sole trader and a named person's address are never written to by this tool (question 2).
 * - **A country not on the list is consent first**, and so not written to cold (question 6).
 * - **One gate for every caller** (overall 7): a store, the platform, any domain or campaign asks `outreachGate()`, which takes no store, so
 *   no store, sending domain or account can loosen it.
 */

export type OutreachRoute = "allowed_with_opt_out" | "consent_first" | "not_at_all";

export type CountryRule = {
  country: string;
  /** What the owner proposes for a company's general enquiry address. */
  generalAddress: OutreachRoute;
  /** The conditions a first email must meet where it may be sent, in the owner's words, short. */
  conditions: string;
  /** The owner's position, kept in Legal reviews (`outreach-rules`, the country's point). */
  ownerPosition: { by: string; on: string };
  /** A lawyer's reading of the row: who and when. Null until one is recorded; nothing is sent under a row without it. */
  legalReading: { by: string; on: string } | null;
};

const OWNER = { by: "the owner, in Legal reviews", on: "2026-11-26" };

export const COUNTRY_RULES: readonly CountryRule[] = [
  {
    country: "NO",
    generalAddress: "allowed_with_opt_out",
    conditions: "One to one, to a verified general enquiry address, relevant to the company's business, the sender named, a free way to stop.",
    ownerPosition: OWNER,
    legalReading: null,
  },
  {
    country: "SE",
    generalAddress: "allowed_with_opt_out",
    conditions: "One to one, to a verified general enquiry address, relevant to the company's business, the sender named, a free way to stop.",
    ownerPosition: OWNER,
    legalReading: null,
  },
  {
    country: "FI",
    generalAddress: "allowed_with_opt_out",
    conditions: "To a verified legal entity that has not refused such marketing, the sender named, an easy and free way to stop.",
    ownerPosition: OWNER,
    legalReading: null,
  },
  {
    country: "FR",
    generalAddress: "allowed_with_opt_out",
    conditions: "About the recipient's professional activity, the sender named, the source and purpose of the data said, a free way to stop.",
    ownerPosition: OWNER,
    legalReading: null,
  },
  {
    country: "DK",
    generalAddress: "consent_first",
    conditions: "Only with documented prior consent; never a first email to ask for it.",
    ownerPosition: OWNER,
    legalReading: null,
  },
  {
    country: "DE",
    generalAddress: "consent_first",
    conditions: "Only with documented prior consent; a published address is not consent.",
    ownerPosition: OWNER,
    legalReading: null,
  },
];

/** A country's rule, or consent first for a country no one has read. */
export function countryRule(country: string): CountryRule {
  return (
    COUNTRY_RULES.find((r) => r.country === country.toUpperCase()) ?? {
      country: country.toUpperCase(),
      generalAddress: "consent_first",
      conditions: "Not read yet: nobody there is written to without consent.",
      ownerPosition: { by: "", on: "" },
      legalReading: null,
    }
  );
}

export type RecipientKind = "legal_entity" | "sole_trader" | "person";
export type AddressKind = "general" | "named_person";

export type GateInput = {
  country: string;
  recipient: RecipientKind;
  address: AddressKind;
  /** On the shared do-not-contact list (P5.6): the address or its domain. */
  suppressed: boolean;
  /** Documented prior consent from this recipient. */
  consented: boolean;
};

export type GateReason =
  | "suppressed"
  | "sole_trader"
  | "person"
  | "named_address"
  | "consent_needed"
  | "not_at_all"
  | "not_read_by_lawyer";

export type GateAnswer = { send: boolean; reasons: GateReason[]; rule: CountryRule };

/**
 * Whether one first email may be sent, and every reason it may not: the do-not-contact list, what the recipient and the address are, the
 * country's route, and whether a lawyer has read the country's row. Asked before an email is written and again just before it is sent
 * (overall 1). Every reason is returned, not the first, so the record shows all the checks (overall 3).
 */
export function outreachGate(input: GateInput): GateAnswer {
  const rule = countryRule(input.country);
  const reasons: GateReason[] = [];
  if (input.suppressed) reasons.push("suppressed");
  if (input.recipient === "sole_trader") reasons.push("sole_trader");
  if (input.recipient === "person") reasons.push("person");
  if (input.address === "named_person") reasons.push("named_address");
  if (rule.generalAddress === "not_at_all") reasons.push("not_at_all");
  if (rule.generalAddress === "consent_first" && !input.consented) reasons.push("consent_needed");
  if (!rule.legalReading) reasons.push("not_read_by_lawyer");
  return { send: reasons.length === 0, reasons, rule };
}

/** What a found company could be, said before anything is written: the country's proposed route and whether a lawyer has read it. */
export function countryStanding(country: string): { route: OutreachRoute; read: boolean } {
  const rule = countryRule(country);
  return { route: rule.generalAddress, read: rule.legalReading !== null };
}
