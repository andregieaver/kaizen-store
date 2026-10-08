import { z } from "zod";

import { conversionFactor, type Rates } from "./currency";
import type { PageBlock, PageColumn, PageRow } from "./page-content";

/**
 * Who sees a part (D179 phase 4, `docs/responsive-editing.md` 6): Beaver Builder's **Display** in the Advanced tab's
 * Visibility. `always` (or nothing set) draws the part for everyone; `never` never draws it on the site; `signedIn` and
 * `signedOut` follow the visitor's sign-in (a store's customer account, or the admin on Kaizen's own pages); conditional
 * logic is groups of conditions, OR between groups and AND within one. The server decides (`<VisiblePart>`,
 * `visitorFacts()`), so a part that is not shown is not in the page at all. Everything here is pure: the rules, their
 * schemas, how a rule holds for a visitor's facts, and the ids a rule names (cleaned when a part crosses to another store).
 */

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export const DISPLAYS = ["always", "never", "signedOut", "signedIn", "rules"] as const;
export type DisplayKind = (typeof DISPLAYS)[number];

export const DISPLAY_LABELS: Record<DisplayKind, string> = {
  always: "Always",
  never: "Never",
  signedOut: "Signed-out visitors",
  signedIn: "Signed-in visitors",
  rules: "Conditional logic",
};

// ---------------------------------------------------------------------------
// Facts and conditions
// ---------------------------------------------------------------------------

/** What a condition can ask about the visitor and the moment, a closed list. */
export const FACTS = [
  "signedIn",
  "customerGroup",
  "company",
  "buyer",
  "boughtBefore",
  "country",
  "language",
  "currency",
  "date",
  "weekday",
  "hour",
  "cartValue",
  "cartProduct",
  "cartCategory",
  "query",
] as const;
export type Fact = (typeof FACTS)[number];

export const OPS = ["is", "isNot", "in", "notIn", "gte", "lte", "between", "contains", "exists", "notExists"] as const;
export type Op = (typeof OPS)[number];

/** Where a fact belongs in the builder's list, and the words the builder uses for it. */
export const FACT_INFO: Record<Fact, { label: string; group: "Visitor" | "Place and language" | "Time" | "Cart and address"; ops: readonly Op[] }> = {
  signedIn: { label: "Signed in", group: "Visitor", ops: ["is"] },
  customerGroup: { label: "Customer group", group: "Visitor", ops: ["in", "notIn"] },
  company: { label: "Company account", group: "Visitor", ops: ["is", "in", "notIn"] },
  buyer: { label: "Buys as", group: "Visitor", ops: ["is", "isNot"] },
  boughtBefore: { label: "Has bought before", group: "Visitor", ops: ["is"] },
  country: { label: "Country", group: "Place and language", ops: ["in", "notIn"] },
  language: { label: "Language", group: "Place and language", ops: ["in", "notIn"] },
  currency: { label: "Currency", group: "Place and language", ops: ["in", "notIn"] },
  date: { label: "Date and time", group: "Time", ops: ["between"] },
  weekday: { label: "Day of the week", group: "Time", ops: ["in", "notIn"] },
  hour: { label: "Time of day", group: "Time", ops: ["between"] },
  cartValue: { label: "Cart value", group: "Cart and address", ops: ["gte", "lte", "between"] },
  cartProduct: { label: "Cart contains product", group: "Cart and address", ops: ["in", "notIn"] },
  cartCategory: { label: "Cart contains a product in category", group: "Cart and address", ops: ["in", "notIn"] },
  query: { label: "Address parameter", group: "Cart and address", ops: ["is", "isNot", "contains", "exists", "notExists"] },
};

export const OP_LABELS: Record<Op, string> = {
  is: "is",
  isNot: "is not",
  in: "is one of",
  notIn: "is none of",
  gte: "is at least",
  lte: "is at most",
  between: "is between",
  contains: "contains",
  exists: "is present",
  notExists: "is not present",
};

/** The facts Kaizen's own pages offer: there is no shop, cart, market or customer there (docs/responsive-editing.md 6). */
export const KAIZEN_FACTS: readonly Fact[] = ["signedIn", "language", "date", "weekday", "hour", "query"];

/**
 * The facts a page offers. Address parameters are read only where the route hands its page the address (pages, the front
 * page, All products, search, working pages, category and tag pages, Kaizen's pages): a header or footer is drawn by the
 * layout, which has none, and articles and product layouts are drawn without them, so `query` is offered on pages only.
 */
export function factsOffered(owner: "store" | "kaizen", pageType: string): Fact[] {
  const base = owner === "kaizen" ? [...KAIZEN_FACTS] : [...FACTS];
  return pageType === "page" ? base : base.filter((fact) => fact !== "query");
}

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABELS: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };

/** The most parts on one page drawn by a rule the server checks per request (signed in, signed out, conditions). */
export const CONDITIONAL_PARTS_MAX = 30;
export const GROUPS_MAX = 10;
export const CONDITIONS_MAX = 10;
export const VALUES_MAX = 50;

const uuid = z.uuid("A condition names something that is not an id.");
const ids = z.array(uuid).max(VALUES_MAX, `A condition takes at most ${VALUES_MAX} choices.`).transform((list) => [...new Set(list)]);
const some = <T extends z.ZodType>(item: T) =>
  z.array(item).min(1, "Choose at least one for each condition.").max(VALUES_MAX, `A condition takes at most ${VALUES_MAX} choices.`);
/** A local date and time in the store's time zone, as `<input type="datetime-local">` gives it. */
const LOCAL_STAMP = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** An address parameter's name: what forms and links use, nothing that could be read as anything else. */
const PARAM = /^[A-Za-z0-9_.\-[\]]{1,64}$/;

const condition = z.discriminatedUnion("fact", [
  z.object({ fact: z.literal("signedIn"), op: z.literal("is"), value: z.boolean() }),
  z.object({ fact: z.literal("customerGroup"), op: z.enum(["in", "notIn"]), value: ids }),
  z.object({ fact: z.literal("company"), op: z.enum(["is", "in", "notIn"]), value: z.union([z.boolean(), ids]) }),
  z.object({ fact: z.literal("buyer"), op: z.enum(["is", "isNot"]), value: z.enum(["business", "private"]) }),
  z.object({ fact: z.literal("boughtBefore"), op: z.literal("is"), value: z.boolean() }),
  z.object({ fact: z.literal("country"), op: z.enum(["in", "notIn"]), value: some(z.string().regex(/^[A-Z]{2}$/, "A country is two capital letters.")) }),
  z.object({ fact: z.literal("language"), op: z.enum(["in", "notIn"]), value: some(z.string().regex(/^[a-z]{2,3}$/, "A language is its code, such as nb or en.")) }),
  z.object({ fact: z.literal("currency"), op: z.enum(["in", "notIn"]), value: some(z.string().regex(/^[A-Z]{3}$/, "A currency is its code, such as NOK.")) }),
  z.object({
    fact: z.literal("date"),
    op: z.literal("between"),
    value: z.object({
      from: z.string().regex(LOCAL_STAMP, "A date needs a day and a time.").optional(),
      to: z.string().regex(LOCAL_STAMP, "A date needs a day and a time.").optional(),
    }),
  }),
  z.object({ fact: z.literal("weekday"), op: z.enum(["in", "notIn"]), value: some(z.number().int().min(1).max(7)).transform((list) => [...new Set(list)].sort()) }),
  z.object({
    fact: z.literal("hour"),
    op: z.literal("between"),
    value: z.object({ from: z.string().regex(CLOCK, "A time of day is hh:mm."), to: z.string().regex(CLOCK, "A time of day is hh:mm.") }),
  }),
  z.object({
    fact: z.literal("cartValue"),
    op: z.enum(["gte", "lte", "between"]),
    value: z.object({
      currency: z.string().regex(/^[A-Z]{3}$/, "A cart value needs its currency."),
      min: z.number().int().min(0).max(1_000_000_000).optional(),
      max: z.number().int().min(0).max(1_000_000_000).optional(),
    }),
  }),
  z.object({ fact: z.literal("cartProduct"), op: z.enum(["in", "notIn"]), value: ids }),
  z.object({ fact: z.literal("cartCategory"), op: z.enum(["in", "notIn"]), value: ids }),
  z.object({
    fact: z.literal("query"),
    op: z.enum(["is", "isNot", "contains", "exists", "notExists"]),
    value: z.object({
      name: z.string().trim().regex(PARAM, "An address parameter's name is letters, digits, - _ . [ ] (up to 64)."),
      text: z.string().trim().max(200, "Keep an address parameter's value under 200 characters.").optional(),
    }),
  }),
], { error: "A condition asks about something unknown." });

export type Condition = z.infer<typeof condition>;
export type ConditionGroup = Condition[];
export type Show = "always" | "never" | "signedIn" | "signedOut" | { rules: ConditionGroup[] };

/** A condition's own problem beyond its shape, in the builder's words; null when it is whole. */
export function conditionProblem(c: Condition): string | null {
  switch (c.fact) {
    case "company":
      return (c.op === "is") !== (typeof c.value === "boolean") ? "A company condition has the wrong kind of value." : null;
    case "date":
      if (!c.value.from && !c.value.to) return "Give a date condition a start, an end or both.";
      return c.value.from && c.value.to && c.value.from >= c.value.to ? "A date condition's start must be before its end." : null;
    case "hour":
      return c.value.from === c.value.to ? "A time of day condition needs two different times." : null;
    case "cartValue": {
      const { min, max } = c.value;
      if (c.op === "gte" && min === undefined) return "Give the cart value an amount.";
      if (c.op === "lte" && max === undefined) return "Give the cart value an amount.";
      if (c.op === "between" && (min === undefined || max === undefined)) return "Give the cart value both amounts.";
      if (c.op === "between" && min! > max!) return "A cart value's lower amount must not be above its upper amount.";
      return null;
    }
    case "query":
      return (c.op === "is" || c.op === "isNot" || c.op === "contains") && !c.value.text ? "Give the address parameter a value to compare." : null;
    default:
      return null;
  }
}

export const conditionSchema = condition.superRefine((c, ctx) => {
  const problem = conditionProblem(c);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

/** A part's Display as stored: `always` is not stored (nothing set is always). */
export const showSchema = z.union([
  z.enum(["always", "never", "signedIn", "signedOut"]),
  z.object({
    rules: z
      .array(
        z
          .array(conditionSchema)
          .min(1, "A group of conditions needs at least one condition.")
          .max(CONDITIONS_MAX, `A group takes at most ${CONDITIONS_MAX} conditions.`),
      )
      .min(1, "Conditional logic needs at least one condition.")
      .max(GROUPS_MAX, `Conditional logic takes at most ${GROUPS_MAX} groups.`),
  }),
], { error: "A part's display is unknown." });

export const displayKind = (show: Show | undefined): DisplayKind =>
  show === undefined ? "always" : typeof show === "string" ? show : "rules";

/** Whether the server has to look at the visitor to draw the part: signed in, signed out or conditions. */
export const isConditional = (show: Show | undefined): boolean => show !== undefined && show !== "always" && show !== "never";

/** A new condition of a fact, with values a person then chooses (the builder's starting point). */
export function newCondition(fact: Fact, currency = "NOK"): Condition {
  switch (fact) {
    case "signedIn":
    case "boughtBefore":
      return { fact, op: "is", value: true };
    case "customerGroup":
    case "cartProduct":
    case "cartCategory":
      return { fact, op: "in", value: [] };
    case "company":
      return { fact, op: "is", value: true };
    case "buyer":
      return { fact, op: "is", value: "business" };
    case "country":
    case "language":
    case "currency":
      return { fact, op: "in", value: [] };
    case "date":
      return { fact, op: "between", value: {} };
    case "weekday":
      return { fact, op: "in", value: [1, 2, 3, 4, 5] };
    case "hour":
      return { fact, op: "between", value: { from: "09:00", to: "17:00" } };
    case "cartValue":
      return { fact, op: "gte", value: { currency, min: 0 } };
    case "query":
      return { fact, op: "exists", value: { name: "" } };
  }
}

// ---------------------------------------------------------------------------
// The visitor's facts and whether a rule holds
// ---------------------------------------------------------------------------

/**
 * What the server knows about one request (`visitorFacts()`, read once per request). Null where a fact does not exist on the
 * page (Kaizen's pages have no market, cart or customer; a header has no address parameters): a condition on an unknown fact
 * never holds, whatever its operator.
 */
export type VisitorFacts = {
  signedIn: boolean;
  /** The customer groups the visitor is in (their own and their company's, D108); empty for a guest. */
  tierIds: string[] | null;
  /** The company account the visitor belongs to (D108): its id or null; the whole fact null where there is none (Kaizen's pages). */
  company: { id: string | null } | null;
  buyer: "business" | "private" | null;
  boughtBefore: boolean | null;
  /** The market's country, upper case. */
  country: string | null;
  /** The language shown, its subtag (`nb`). */
  language: string | null;
  /** The currency shown. */
  currency: string | null;
  now: Date;
  timeZone: string;
  /** The cart's items as shown (currency and VAT display), in minor units; null where there is no cart fact. */
  cart: { minor: number; currency: string; products: string[]; categories: string[] } | null;
  /** The store's rates, to compare a cart value written in another currency. */
  rates: Rates | null;
  /** The address's parameters, or null where the page cannot read them. */
  query: Record<string, string | string[] | undefined> | null;
};

/** A moment's local date, time and day of the week in a time zone. */
export function localClock(now: Date, timeZone: string): { stamp: string; time: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const time = `${parts.hour}:${parts.minute}`;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { stamp: `${parts.year}-${parts.month}-${parts.day}T${time}`, time, weekday };
}

const among = <T>(value: T | null, list: readonly T[], op: "in" | "notIn"): boolean =>
  value === null ? false : op === "in" ? list.includes(value) : !list.includes(value);
const anyAmong = (have: readonly string[] | null, list: readonly string[], op: "in" | "notIn"): boolean => {
  if (have === null) return false;
  const found = have.some((id) => list.includes(id));
  return op === "in" ? found : !found;
};

/** Whether the cart's value meets an amount written in a currency: compared in minor units, converted at the store's rates. */
function cartMeets(cart: NonNullable<VisitorFacts["cart"]>, value: { currency: string; min?: number; max?: number }, op: "gte" | "lte" | "between", rates: Rates | null): boolean {
  let factor: { factor: number } | null = null;
  try {
    factor = value.currency === cart.currency ? { factor: 1 } : rates ? conversionFactor(value.currency, cart.currency, rates) : null;
  } catch {
    // A currency Kaizen does not know: no comparison.
  }
  if (!factor) return false;
  // The amount in the cart's currency, unrounded: a threshold is a line, not a price.
  const at = (amount: number) => amount * factor.factor;
  const low = value.min === undefined ? null : at(value.min);
  const high = value.max === undefined ? null : at(value.max);
  if (op === "gte") return low !== null && cart.minor >= low;
  if (op === "lte") return high !== null && cart.minor <= high;
  return low !== null && high !== null && cart.minor >= low && cart.minor <= high;
}

/** Whether one condition holds for the visitor. */
export function conditionHolds(c: Condition, facts: VisitorFacts): boolean {
  switch (c.fact) {
    case "signedIn":
      return facts.signedIn === c.value;
    case "customerGroup":
      return anyAmong(facts.tierIds, c.value, c.op);
    case "company":
      if (!facts.company) return false;
      if (c.op === "is") return (facts.company.id !== null) === c.value;
      return Array.isArray(c.value) ? anyAmong(facts.company.id === null ? [] : [facts.company.id], c.value, c.op) : false;
    case "buyer":
      return facts.buyer === null ? false : (facts.buyer === c.value) === (c.op === "is");
    case "boughtBefore":
      return facts.boughtBefore === null ? false : facts.boughtBefore === c.value;
    case "country":
      return among(facts.country, c.value, c.op);
    case "language":
      return among(facts.language, c.value, c.op);
    case "currency":
      return among(facts.currency, c.value, c.op);
    case "date": {
      const { stamp } = localClock(facts.now, facts.timeZone);
      return (!c.value.from || stamp >= c.value.from) && (!c.value.to || stamp < c.value.to);
    }
    case "weekday":
      return among(localClock(facts.now, facts.timeZone).weekday, c.value, c.op);
    case "hour": {
      const { time } = localClock(facts.now, facts.timeZone);
      const { from, to } = c.value;
      // From inclusive to exclusive; a start after the end runs over midnight (22:00–06:00).
      return from < to ? time >= from && time < to : time >= from || time < to;
    }
    case "cartValue":
      return facts.cart ? cartMeets(facts.cart, c.value, c.op, facts.rates) : false;
    case "cartProduct":
      return anyAmong(facts.cart?.products ?? null, c.value, c.op);
    case "cartCategory":
      return anyAmong(facts.cart?.categories ?? null, c.value, c.op);
    case "query": {
      if (facts.query === null) return false;
      const raw = facts.query[c.value.name];
      const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      const text = c.value.text ?? "";
      if (c.op === "exists") return raw !== undefined;
      if (c.op === "notExists") return raw === undefined;
      if (c.op === "is") return values.includes(text);
      if (c.op === "isNot") return !values.includes(text);
      return values.some((value) => value.toLowerCase().includes(text.toLowerCase()));
    }
  }
}

/** Whether a part with this display is drawn for the visitor: OR between groups, AND within one. */
export function showsFor(show: Show | undefined, facts: VisitorFacts): boolean {
  if (show === undefined || show === "always") return true;
  if (show === "never") return false;
  if (show === "signedIn") return facts.signedIn;
  if (show === "signedOut") return !facts.signedIn;
  return show.rules.some((group) => group.every((c) => conditionHolds(c, facts)));
}

// ---------------------------------------------------------------------------
// Ids a rule names: checked on save, cleaned when a part crosses to another store
// ---------------------------------------------------------------------------

export type RuleIdKind = "tier" | "company" | "product" | "category";
const ID_FACT: Partial<Record<Fact, RuleIdKind>> = { customerGroup: "tier", company: "company", cartProduct: "product", cartCategory: "category" };

/** The kind of thing a condition's ids are, or null for a condition that names none. */
export const idKindOf = (c: Condition): RuleIdKind | null => (Array.isArray(c.value) ? (ID_FACT[c.fact] ?? null) : null);

/** Every id a display names, by kind. */
export function ruleIds(show: Show | undefined): Record<RuleIdKind, string[]> {
  const found: Record<RuleIdKind, Set<string>> = { tier: new Set(), company: new Set(), product: new Set(), category: new Set() };
  if (show && typeof show === "object") {
    for (const c of show.rules.flat()) {
      const kind = idKindOf(c);
      if (kind) for (const id of c.value as string[]) found[kind].add(id);
    }
  }
  return { tier: [...found.tier], company: [...found.company], product: [...found.product], category: [...found.category] };
}

/**
 * A display with only the ids `keep` keeps. A condition left choosing nothing stays (it then holds for nobody with "is one
 * of" and for everybody with "is none of", as for a thing deleted), so a part never starts showing because its rule was cut.
 */
export function keepRuleIds(show: Show | undefined, keep: (kind: RuleIdKind, id: string) => boolean): Show | undefined {
  if (!show || typeof show !== "object") return show;
  return {
    rules: show.rules.map((group) =>
      group.map((c) => {
        const kind = idKindOf(c);
        return kind ? ({ ...c, value: (c.value as string[]).filter((id) => keep(kind, id)) } as Condition) : c;
      }),
    ),
  };
}

type Part = PageRow | PageColumn | PageBlock;
type WithVisibility = { visibility?: { hideAt?: unknown; show?: Show } };

/** A part with its display through `fn` (nothing else changes). */
function withShow<T extends WithVisibility>(part: T, fn: (show: Show | undefined) => Show | undefined): T {
  const show = part.visibility?.show;
  if (show === undefined) return part;
  const next = fn(show);
  if (next === show) return part;
  return { ...part, visibility: { ...part.visibility, show: next } };
}

/** Rows (and every column and block in them) with each display through `fn`. */
export function mapShows(rows: PageRow[], fn: (show: Show | undefined) => Show | undefined): PageRow[] {
  return rows.map((row) =>
    withShow(
      { ...row, columns: row.columns.map((column) => withShow({ ...column, blocks: column.blocks.map((block) => withShow(block, fn)) }, fn)) },
      fn,
    ),
  );
}

const isRow = (part: Part): part is PageRow => (part as { type?: unknown }).type === "row";
const isColumn = (part: Part): part is PageColumn => !("type" in part) && Array.isArray((part as PageColumn).blocks);

/** A row, column or block with each display through `fn`, inside too. */
export function mapPartShows<T extends Part>(part: T, fn: (show: Show | undefined) => Show | undefined): T {
  if (isRow(part)) return mapShows([part], fn)[0] as T;
  if (isColumn(part)) return withShow({ ...part, blocks: part.blocks.map((block) => withShow(block, fn)) }, fn) as T;
  return withShow(part, fn);
}

/** Every display on these rows, with the part it is on. */
export function partShows(rows: readonly PageRow[]): { part: Part; kind: "row" | "column" | "block"; show: Show }[] {
  const found: { part: Part; kind: "row" | "column" | "block"; show: Show }[] = [];
  for (const row of rows) {
    if (row.visibility?.show) found.push({ part: row, kind: "row", show: row.visibility.show });
    for (const column of row.columns) {
      if (column.visibility?.show) found.push({ part: column, kind: "column", show: column.visibility.show });
      for (const block of column.blocks) if (block.visibility?.show) found.push({ part: block, kind: "block", show: block.visibility.show });
    }
  }
  return found;
}

/** Every id the displays on these rows name, by kind. */
export function pageRuleIds(rows: readonly PageRow[]): Record<RuleIdKind, string[]> {
  const all: Record<RuleIdKind, Set<string>> = { tier: new Set(), company: new Set(), product: new Set(), category: new Set() };
  for (const { show } of partShows(rows)) {
    const found = ruleIds(show);
    for (const kind of Object.keys(all) as RuleIdKind[]) for (const id of found[kind]) all[kind].add(id);
  }
  return { tier: [...all.tier], company: [...all.company], product: [...all.product], category: [...all.category] };
}

/** A copy for another store (a template, a design profile): the ids of this store's groups, companies, products and categories go. */
export const withoutRuleIds = <T extends Part>(part: T): T => mapPartShows(part, (show) => keepRuleIds(show, () => false));

/** The facts a display asks about. */
export const showFacts = (show: Show | undefined): Fact[] =>
  show && typeof show === "object" ? [...new Set(show.rules.flat().map((c) => c.fact))] : [];

/**
 * Store-copy parts that must be shown to everyone: the checkout's payment form and its terms (D158), and the checkout as a
 * whole, are never behind a display, nor the row and column holding them; the withdrawal link (D153) neither.
 */
const ALWAYS_PARTS = new Set(["checkout", "checkout_payment", "checkout_terms"]);
const mustShow = (block: PageBlock): boolean =>
  (block.type === "storePart" && ALWAYS_PARTS.has(block.part)) || (block.type === "site" && block.part === "withdrawal");

/** Why a part cannot take a display other than Always, or null. */
export function displayLocked(part: Part): string | null {
  const blocks: PageBlock[] = isRow(part) ? part.columns.flatMap((c) => c.blocks) : isColumn(part) ? part.blocks : [part as PageBlock];
  if (blocks.some((b) => b.type === "site" && b.part === "withdrawal")) return "The withdrawal link is for every visitor, so it is always shown.";
  if (blocks.some(mustShow)) return "The checkout's payment form and terms are for every buyer, so they are always shown.";
  return null;
}

/** What is wrong with the displays on a page: too many parts checked per request, or one on a part that must always show. */
export function displaysProblem(rows: readonly PageRow[]): string | null {
  const shows = partShows(rows);
  const conditional = shows.filter(({ show }) => isConditional(show)).length;
  if (conditional > CONDITIONAL_PARTS_MAX) {
    return `A page takes at most ${CONDITIONAL_PARTS_MAX} parts shown by sign-in or conditions; this one has ${conditional}.`;
  }
  for (const { part, show } of shows) {
    if (show === "always") continue;
    const locked = displayLocked(part);
    if (locked) return locked;
  }
  return null;
}

/** Why a store's or Kaizen's page may not use a display's facts, or null. */
export function displayFactsProblem(rows: readonly PageRow[], owner: "store" | "kaizen", pageType: string): string | null {
  const offered = new Set(factsOffered(owner, pageType));
  for (const { show } of partShows(rows)) {
    const missing = showFacts(show).find((fact) => !offered.has(fact));
    if (missing) {
      return owner === "kaizen"
        ? `Kaizen's pages offer only sign-in, language, time and address conditions, not "${FACT_INFO[missing].label}".`
        : `Address parameters are read on pages only, not in a ${pageType.replace("_", " ")}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the builder offers
// ---------------------------------------------------------------------------

type Named = { id: string; name: string };

/**
 * What the rule builder chooses from: the store's own groups, companies, products, categories, countries, languages and
 * currencies, and its time zone (shown beside every time). Companies are listed only to staff who may read customers (D158);
 * others choose "has a company account" only. Kaizen's pages have none of the store's.
 */
export type VisibilityChoices = {
  owner: "store" | "kaizen";
  timeZone: string;
  /** The store's main currency, the one a new cart value condition is written in. */
  currency: string;
  groups: Named[];
  companies: Named[] | null;
  products: Named[];
  categories: Named[];
  countries: { code: string; name: string }[];
  languages: { code: string; name: string }[];
  currencies: string[];
};

export const KAIZEN_CHOICES: VisibilityChoices = {
  owner: "kaizen",
  timeZone: "Europe/Oslo",
  currency: "EUR",
  groups: [],
  companies: null,
  products: [],
  categories: [],
  countries: [],
  languages: [{ code: "en", name: "English" }],
  currencies: [],
};

// ---------------------------------------------------------------------------
// What every visitor may read
// ---------------------------------------------------------------------------

/** Whether every visitor sees a part's words (its display is Always), so a page may say them about itself to anyone. */
export const readByAnyone = (part: { visibility?: { show?: Show } }): boolean => {
  const show = part.visibility?.show;
  return show === undefined || show === "always";
};

/**
 * The rows as every visitor sees them: a part that is never shown, or shown only to signed-in or signed-out visitors or by
 * conditions, is left out. What a page says about itself to anyone else (its description,
 * structured data, the chat agent's knowledge) is read from these, so a members' paragraph never leaks into them.
 */
export function publicRows(rows: readonly PageRow[]): PageRow[] {
  return rows.filter(readByAnyone).map((row) => ({
    ...row,
    columns: row.columns.filter(readByAnyone).map((column) => ({ ...column, blocks: column.blocks.filter(readByAnyone) })),
  }));
}
