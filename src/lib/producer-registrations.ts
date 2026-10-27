/**
 * Producer responsibility (wave 7 unit H, D342, `docs/wave-7-storefront.md` section 4, H), pure: what a registration is, how one typed on
 * the page or given to the AI manager is checked, whether it covers a day, and when a lapsed one starts blocking sales. The rule that
 * blocks a sale is the database's (`commerce.registration_blocks()`): a product under a scheme is not sold in a market where no registration
 * (or exemption) of the store's covers the store's own day, whether one was ever recorded or not (the owner's decision of 27 October 2026).
 * A registration that ends on a day still covers it, so sales stop from the next day. A product's schemes are ticked by the owner (none by
 * default); a store template or demo store never blocks, so its products are only listed.
 *
 * A registration has its number and the authority (or producer responsibility organisation) that gave it; an exemption has, in the owner's
 * words, why none is needed there (no scheme in that country, below its threshold) and no number. Both are the company's, never copied.
 */

/** The schemes, as `PRODUCER_SCHEMES` in `product-input.ts` and the `producer_scheme` enum have them. */
export const SCHEME_IDS = ["packaging", "electrical_equipment", "batteries", "textiles", "furniture", "tyres"] as const;
export type SchemeId = (typeof SCHEME_IDS)[number];
export const isSchemeId = (value: unknown): value is SchemeId => (SCHEME_IDS as readonly unknown[]).includes(value);

export type RegistrationKind = "registered" | "exempt";

/** A registration as the page and the AI manager give it; days are `YYYY-MM-DD`, `validTo` null for open-ended. */
export type RegistrationInput = {
  scheme: SchemeId;
  market: string;
  kind: RegistrationKind;
  number: string | null;
  authority: string | null;
  exemption: string | null;
  showNumber: boolean;
  validFrom: string;
  validTo: string | null;
};

export type Registration = RegistrationInput & { id: string };

export const REGISTRATION_LIMITS = { number: 100, authority: 200, exemption: 300 } as const;

/** Why a registration cannot be saved, one code per field, worded by the `settings` catalogue's `producer.problems` (and `PROBLEM_WORDS`). */
export type RegistrationProblem = "scheme" | "market" | "number" | "authority" | "exemption" | "from" | "to" | "range";

/** The English words of each problem, for the AI manager's answers (the page shows the catalogue's). */
export const PROBLEM_WORDS: Record<RegistrationProblem, string> = {
  scheme: "Choose one of the schemes.",
  market: "Choose one of the store's countries.",
  number: `Type the registration number, on one line, at most ${REGISTRATION_LIMITS.number} characters.`,
  authority: `Type who gave the registration (the authority or the producer responsibility organisation), at most ${REGISTRATION_LIMITS.authority} characters.`,
  exemption: `Say why no registration is needed in that country, at most ${REGISTRATION_LIMITS.exemption} characters.`,
  from: "Give the day the registration starts.",
  to: "The last day is not a day.",
  range: "The last day cannot be before the first.",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a real calendar day written `YYYY-MM-DD`. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The day after `day` (`YYYY-MM-DD`). */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Text trimmed to one line; empty is null. */
function line(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/**
 * Checks a registration as typed, against the store's countries: the cleaned registration, or every problem found. A registration needs its
 * number and authority; an exemption its reason, and it keeps neither number nor authority and is never shown on product pages.
 */
export function checkRegistration(
  raw: {
    scheme?: unknown;
    market?: unknown;
    kind?: unknown;
    number?: unknown;
    authority?: unknown;
    exemption?: unknown;
    showNumber?: unknown;
    validFrom?: unknown;
    validTo?: unknown;
  },
  markets: readonly string[],
): { ok: true; value: RegistrationInput } | { ok: false; problems: RegistrationProblem[] } {
  const problems: RegistrationProblem[] = [];
  const scheme = isSchemeId(raw.scheme) ? raw.scheme : null;
  if (!scheme) problems.push("scheme");
  const market = typeof raw.market === "string" ? raw.market.trim().toUpperCase() : "";
  if (!markets.includes(market)) problems.push("market");
  const kind: RegistrationKind = raw.kind === "exempt" ? "exempt" : "registered";
  const number = line(raw.number);
  const authority = line(raw.authority);
  const exemption = line(raw.exemption);
  if (kind === "registered") {
    if (!number || number.length > REGISTRATION_LIMITS.number) problems.push("number");
    if (!authority || authority.length > REGISTRATION_LIMITS.authority) problems.push("authority");
  } else if (!exemption || exemption.length > REGISTRATION_LIMITS.exemption) problems.push("exemption");
  const validFrom = typeof raw.validFrom === "string" ? raw.validFrom.trim() : "";
  if (!isDay(validFrom)) problems.push("from");
  const to = typeof raw.validTo === "string" ? raw.validTo.trim() : null;
  const validTo = to === "" ? null : to;
  if (validTo !== null && !isDay(validTo)) problems.push("to");
  else if (validTo !== null && isDay(validFrom) && validTo < validFrom) problems.push("range");
  if (problems.length > 0 || !scheme) return { ok: false, problems };
  return {
    ok: true,
    value:
      kind === "registered"
        ? { scheme, market, kind, number, authority, exemption: null, showNumber: raw.showNumber === true, validFrom, validTo }
        : { scheme, market, kind, number: null, authority: null, exemption, showNumber: false, validFrom, validTo },
  };
}

export type RegistrationState = "upcoming" | "valid" | "ended";

/** Where a registration stands on `today` (the store's day): not begun, covering the day, or over. */
export function registrationState(reg: Pick<RegistrationInput, "validFrom" | "validTo">, today: string): RegistrationState {
  if (reg.validFrom > today) return "upcoming";
  if (reg.validTo !== null && reg.validTo < today) return "ended";
  return "valid";
}

/** Whether a registration covers `day`: the database's rule in `commerce.registration_blocks()`, for the page and the tests. */
export const covers = (reg: Pick<RegistrationInput, "validFrom" | "validTo">, day: string): boolean => registrationState(reg, day) === "valid";

/** The first day sales stop when this registration ends and nothing follows it: the day after its last, or null for none. */
export const firstBlockedDay = (reg: Pick<RegistrationInput, "validTo">): string | null => (reg.validTo === null ? null : nextDay(reg.validTo));

/**
 * Whether a registration's number goes on the market's product pages unless the owner says otherwise. The owner decides on each
 * registration; this is only the starting tick, from our reading of what is asked of online sellers (Germany: the WEEE and battery
 * registration numbers in offers and invoices, under ElektroG and BattDG; France: the producer's unique identifier, the IDU, for every
 * scheme). Not checked by a lawyer: flagged for legal review, never a statement that a number must or need not be shown.
 */
export const SHOW_NUMBER_RULES: readonly { market: string; schemes: readonly SchemeId[] | "all"; verified: false }[] = [
  { market: "DE", schemes: ["electrical_equipment", "batteries"], verified: false },
  { market: "FR", schemes: "all", verified: false },
];

export function numberShownByDefault(scheme: SchemeId, market: string): boolean {
  return SHOW_NUMBER_RULES.some((rule) => rule.market === market.toUpperCase() && (rule.schemes === "all" || rule.schemes.includes(scheme)));
}

/**
 * A product under a scheme with nothing valid in a market today, as the view lists it: `blocked` (not sold there) in every real store, and
 * not in a store template or demo store, which is never held back.
 */
export type MissingRow = { productId: string; handle: string; title: string; market: string; scheme: SchemeId; blocked: boolean };

/** What is missing, by scheme and market: the products each concerns, by title, and whether they are not sold there. The page's and the AI manager's list. */
export type MissingGroup = { scheme: SchemeId; market: string; blocked: boolean; products: { id: string; handle: string; title: string }[] };

export function groupMissing(rows: readonly MissingRow[]): MissingGroup[] {
  const groups = new Map<string, MissingGroup>();
  for (const row of rows) {
    const key = `${row.scheme}:${row.market}`;
    const group = groups.get(key) ?? { scheme: row.scheme, market: row.market, blocked: row.blocked, products: [] };
    if (!group.products.some((p) => p.id === row.productId)) group.products.push({ id: row.productId, handle: row.handle, title: row.title });
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, products: [...g.products].sort((a, b) => a.title.localeCompare(b.title)) }))
    .sort((a, b) => SCHEME_IDS.indexOf(a.scheme) - SCHEME_IDS.indexOf(b.scheme) || a.market.localeCompare(b.market));
}

/** Registrations that end within `days` of `today` with nothing valid after them for the same scheme and market: the page warns of them. */
export function endingSoon(regs: readonly Registration[], today: string, days = 30): Registration[] {
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const until = limit.toISOString().slice(0, 10);
  return regs.filter(
    (reg) =>
      reg.validTo !== null &&
      covers(reg, today) &&
      reg.validTo <= until &&
      !regs.some((other) => other.id !== reg.id && other.scheme === reg.scheme && other.market === reg.market && covers(other, nextDay(reg.validTo!))),
  );
}
