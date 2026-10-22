import { z } from "zod";

import { countWords, fillWords } from "./admin-fill";
import { marketingEn, type MarketingMessages } from "./admin-messages/marketing.en";
import { RFM_SEGMENTS, type RfmSegment } from "./analytics-customers";
import { SUBSCRIBER_STATUSES, type SubscriberStatus } from "./marketing-consent";
import { tagKey } from "./order-tags";

/**
 * Segments (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4): saved rules over a store's people, counted when read. Pure: the rules, their
 * check, whether a person matches and the words for staff. The people are read by `segmentPeople()` (`src/server/segments.ts`).
 */

export const SEGMENTS_MAX = 100;
export const CONDITIONS_MAX = 20;
/** The reader stops here and says so. */
export const SEGMENT_CAP = 100_000;
/** People listed on a segment's page. */
export const SEGMENT_SAMPLE = 100;
export const TAGS_PER_PERSON = 50;
const DAY_MS = 86_400_000;

export type Consent = SubscriberStatus | "none";
export const CONSENTS: readonly Consent[] = [...SUBSCRIBER_STATUSES, "none"];

/** What a segment is about: one email address of the store, with the facts its conditions read. */
export type Person = {
  email: string;
  customerId: string | null;
  name: string;
  account: boolean;
  /** Two-letter language, or null. */
  language: string | null;
  /** The country of the last paid order, else the subscriber row's market; two letters, or null. */
  country: string | null;
  groupId: string | null;
  company: boolean;
  orders: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  /** Net revenue without VAT in the main currency; null when some of it is in a currency with no rate. */
  spentMinor: number | null;
  consent: Consent;
  rfm: RfmSegment | null;
  /** Tag keys. */
  tags: string[];
};

const count = z.number().int().min(0).max(1_000_000);
const days = z.number().int().min(1).max(3650);
const codes = (max: number) => z.array(z.string().regex(/^[a-z]{2}$/i).transform((c) => c.toLowerCase())).min(1).max(max);

export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("consent"), statuses: z.array(z.enum(CONSENTS as [Consent, ...Consent[]])).min(1).max(4) }),
  z.object({ kind: z.literal("orders"), op: z.enum(["atLeast", "atMost", "exactly"]), value: count }),
  z.object({ kind: z.literal("spent"), op: z.enum(["atLeast", "atMost"]), minor: z.number().int().min(0).max(1_000_000_000_00) }),
  z.object({ kind: z.literal("lastOrder"), op: z.enum(["within", "before", "never"]), days: days.optional() }),
  z.object({ kind: z.literal("firstOrder"), op: z.enum(["within", "before"]), days }),
  z.object({ kind: z.literal("rfm"), groups: z.array(z.enum(RFM_SEGMENTS)).min(1).max(RFM_SEGMENTS.length) }),
  z.object({ kind: z.literal("country"), codes: codes(60) }),
  z.object({ kind: z.literal("language"), codes: codes(40) }),
  z.object({ kind: z.literal("group"), ids: z.array(z.uuid()).min(1).max(50) }),
  z.object({ kind: z.literal("company"), has: z.boolean() }),
  z.object({ kind: z.literal("account"), has: z.boolean() }),
  z.object({ kind: z.literal("tag"), tags: z.array(z.string().max(80)).min(1).max(20) }),
]);
export type Condition = z.infer<typeof conditionSchema>;
export type ConditionKind = Condition["kind"];

export const segmentRulesSchema = z
  .object({ match: z.enum(["all", "any"]), conditions: z.array(conditionSchema).max(CONDITIONS_MAX) })
  .superRefine((rules, ctx) => {
    rules.conditions.forEach((c, i) => {
      if (c.kind === "lastOrder" && c.op !== "never" && c.days === undefined) ctx.addIssue({ code: "custom", path: ["conditions", i, "days"], message: "Give a number of days." });
      if (c.kind === "tag" && c.tags.some((t) => tagKey(t) === null)) ctx.addIssue({ code: "custom", path: ["conditions", i, "tags"], message: "A tag is not valid." });
    });
  });
export type SegmentRules = z.infer<typeof segmentRulesSchema>;

export const segmentInput = z.object({
  name: z.string().trim().min(1, "Give the segment a name.").max(80),
  rules: segmentRulesSchema,
});
export type SegmentInput = z.infer<typeof segmentInput>;

const ageDays = (iso: string | null, today: Date): number | null => (iso ? Math.floor((today.getTime() - new Date(iso).getTime()) / DAY_MS) : null);

/** Whether one condition holds for a person, at `today`. A fact that is not known (money in a currency with no rate) holds for no condition. */
export function holds(c: Condition, p: Person, today: Date): boolean {
  switch (c.kind) {
    case "consent":
      return c.statuses.includes(p.consent);
    case "orders":
      return c.op === "atLeast" ? p.orders >= c.value : c.op === "atMost" ? p.orders <= c.value : p.orders === c.value;
    case "spent":
      if (p.spentMinor === null) return false;
      return c.op === "atLeast" ? p.spentMinor >= c.minor : p.spentMinor <= c.minor;
    case "lastOrder": {
      if (c.op === "never") return p.lastOrderAt === null;
      const age = ageDays(p.lastOrderAt, today);
      if (age === null) return false;
      return c.op === "within" ? age < (c.days ?? 0) : age >= (c.days ?? 0);
    }
    case "firstOrder": {
      const age = ageDays(p.firstOrderAt, today);
      if (age === null) return false;
      return c.op === "within" ? age < c.days : age >= c.days;
    }
    case "rfm":
      return p.rfm !== null && c.groups.includes(p.rfm);
    case "country":
      return p.country !== null && c.codes.includes(p.country.toLowerCase());
    case "language":
      return p.language !== null && c.codes.includes(p.language.toLowerCase());
    case "group":
      return p.groupId !== null && c.ids.includes(p.groupId);
    case "company":
      return p.company === c.has;
    case "account":
      return p.account === c.has;
    case "tag": {
      const wanted = c.tags.map(tagKey).filter((k): k is string => k !== null);
      return wanted.some((k) => p.tags.includes(k));
    }
  }
}

/** Whether a person is in a segment: every condition (`all`) or one of them (`any`). No conditions: everyone. */
export function matches(rules: SegmentRules, p: Person, today: Date): boolean {
  if (rules.conditions.length === 0) return true;
  return rules.match === "all" ? rules.conditions.every((c) => holds(c, p, today)) : rules.conditions.some((c) => holds(c, p, today));
}

export type SegmentCount = { people: number; subscribed: number; moneyUnknown: number };

/** How many match, how many of them want the store's emails, and how many could not be judged on money (a currency with no rate). */
export function countSegment(rules: SegmentRules, people: readonly Person[], today: Date): SegmentCount {
  const usesMoney = rules.conditions.some((c) => c.kind === "spent");
  let n = 0;
  let subscribed = 0;
  let unknown = 0;
  for (const p of people) {
    if (usesMoney && p.spentMinor === null) unknown += 1;
    if (!matches(rules, p, today)) continue;
    n += 1;
    if (p.consent === "subscribed") subscribed += 1;
  }
  return { people: n, subscribed, moneyUnknown: unknown };
}

const or = (words: readonly string[], w: DescribeWords) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} ${w.or} ${words.at(-1)}`);

/** The sentences a condition is written in (D312 A6): the marketing catalogue's `describe`, English unless given. */
export type DescribeWords = MarketingMessages["describe"];

export type DescribeContext = {
  /** Writes an amount of the main currency. */
  money: (minor: number) => string;
  groupName?: (id: string) => string | undefined;
  countryName?: (code: string) => string;
  words?: DescribeWords;
};

/** A condition in staff's words: *Ordered at least 2 times*. */
export function describeCondition(c: Condition, ctx: DescribeContext): string {
  const w = ctx.words ?? marketingEn.describe;
  const times = (n: number) => countWords(n, w.times);
  const days = (n: number) => countWords(n, w.days);
  switch (c.kind) {
    case "consent":
      return fillWords(w.consent, { list: or(c.statuses.map((s) => w.consentWords[s]), w) });
    case "orders":
      return fillWords(c.op === "atLeast" ? w.ordersAtLeast : c.op === "atMost" ? w.ordersAtMost : w.ordersExactly, { times: times(c.value) });
    case "spent":
      return fillWords(c.op === "atLeast" ? w.spentAtLeast : w.spentAtMost, { money: ctx.money(c.minor) });
    case "lastOrder":
      return c.op === "never" ? w.neverOrdered : fillWords(c.op === "within" ? w.lastWithin : w.lastBefore, { days: days(c.days ?? 0) });
    case "firstOrder":
      return fillWords(c.op === "within" ? w.firstWithin : w.firstBefore, { days: days(c.days) });
    case "rfm":
      return fillWords(w.rfm, { list: or(c.groups, w) });
    case "country":
      return fillWords(w.country, { list: or(c.codes.map((code) => ctx.countryName?.(code) ?? code.toUpperCase()), w) });
    case "language":
      return fillWords(w.language, { list: or(c.codes.map((code) => code.toUpperCase()), w) });
    case "group":
      return fillWords(w.group, { list: or(c.ids.map((id) => ctx.groupName?.(id) ?? w.goneGroup), w) });
    case "company":
      return c.has ? w.company : w.noCompany;
    case "account":
      return c.has ? w.account : w.noAccount;
    case "tag":
      return fillWords(w.tag, { list: or(c.tags.map((tag) => fillWords(w.quoted, { tag })), w) });
  }
}

/** The rules as one line: the conditions joined by "and" or "or"; *Everyone* without any. */
export function describeRules(rules: SegmentRules, ctx: DescribeContext): string {
  const w = ctx.words ?? marketingEn.describe;
  if (rules.conditions.length === 0) return w.everyone;
  return rules.conditions.map((c) => describeCondition(c, ctx)).join(rules.match === "all" ? w.andJoin : w.orJoin);
}

/** Ready rule sets offered by *New segment*; each is a normal segment once saved. */
export const SEGMENT_STARTERS: readonly { key: string; name: string; line: string; rules: SegmentRules }[] = [
  { key: "subscribers", name: "People who want your emails", line: "Everyone on your subscriber list.", rules: { match: "all", conditions: [{ kind: "consent", statuses: ["subscribed"] }] } },
  { key: "vip", name: "Your best customers", line: "Recent, frequent and big spenders.", rules: { match: "all", conditions: [{ kind: "rfm", groups: ["VIP", "Loyal"] }] } },
  { key: "at-risk", name: "Good customers gone quiet", line: "They bought often or a lot, but not lately.", rules: { match: "all", conditions: [{ kind: "rfm", groups: ["At risk"] }] } },
  { key: "one-order", name: "Ordered once", line: "Customers who have not come back yet.", rules: { match: "all", conditions: [{ kind: "orders", op: "exactly", value: 1 }] } },
  { key: "lapsed", name: "No order in six months", line: "Customers whose last order is more than 180 days old.", rules: { match: "all", conditions: [{ kind: "lastOrder", op: "before", days: 180 }] } },
  {
    key: "never-bought",
    name: "Subscribed but never bought",
    line: "On your list, with no order yet.",
    rules: { match: "all", conditions: [{ kind: "consent", statuses: ["subscribed"] }, { kind: "lastOrder", op: "never" }] },
  },
];

/** A fresh condition of a kind, as the rule builder adds one. */
export function newCondition(kind: ConditionKind): Condition {
  switch (kind) {
    case "consent":
      return { kind, statuses: ["subscribed"] };
    case "orders":
      return { kind, op: "atLeast", value: 1 };
    case "spent":
      return { kind, op: "atLeast", minor: 100_000 };
    case "lastOrder":
      return { kind, op: "within", days: 30 };
    case "firstOrder":
      return { kind, op: "within", days: 30 };
    case "rfm":
      return { kind, groups: ["VIP"] };
    case "country":
      return { kind, codes: ["no"] };
    case "language":
      return { kind, codes: ["nb"] };
    case "group":
      return { kind, ids: [] };
    case "company":
      return { kind, has: true };
    case "account":
      return { kind, has: true };
    case "tag":
      return { kind, tags: [""] };
  }
}

export const CONDITION_KIND_WORDS: Record<ConditionKind, string> = {
  consent: "Email consent",
  orders: "Number of orders",
  spent: "Money spent",
  lastOrder: "Last order",
  firstOrder: "First order",
  rfm: "Customer type",
  country: "Country",
  language: "Language",
  group: "Customer group",
  company: "Company account",
  account: "Account",
  tag: "Tag",
};
