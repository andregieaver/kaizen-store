/**
 * Records in the page finder (ecosystem plan E2.2, D713): after the pages, ⌘K offers the orders, customers, support conversations, deals and
 * products that match what was typed, at most five of each, under a heading per kind, each a link to its own admin page. Pure: what is
 * looked for, which kinds a person may be offered, where each record opens, and the order the kinds are shown in. The reads are
 * `src/server/finder-records.ts`; the search runs only from two characters on, and only on the conditions the stores' indexes serve for
 * orders (a number's start, an exact email), never a search through every order's words.
 */

import type { PermissionKey } from "./permissions";
import { escapeLike, normaliseSearch } from "./order-search";
import type { FinderGroup } from "./finder-groups";
import { storeExtensionOn, type ExtensionId } from "./extensions";
import { requirementMet, type FeatureRequirement, type FeatureSource } from "./store-features";
import { CUSTOMERS_FEATURE } from "./store-nav";

/** The kinds of record, in the order they are shown when none holds an exact match. */
export const RECORD_KINDS = ["order", "customer", "conversation", "deal", "product"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** The most records of one kind offered: the finder is a door to a record, the kind's own list is for browsing. */
export const RECORDS_PER_KIND = 5;
/** Fewer characters than this find pages only: one letter would match half of every list. */
export const RECORD_QUERY_MIN = 2;

/** The key a person needs to be offered a kind: the read key of the area its page is in (deals sit with customers, D464). */
export const RECORD_KEYS: Record<RecordKind, PermissionKey> = {
  order: "orders:read",
  customer: "customers:read",
  conversation: "support:read",
  deal: "customers:read",
  product: "products:read",
};

/** The store feature a kind's pages stand behind (D178), as the navigation says it; orders and the inbox stand behind none. */
export const RECORD_FEATURES: Record<RecordKind, FeatureRequirement | undefined> = {
  order: undefined,
  customer: CUSTOMERS_FEATURE,
  conversation: undefined,
  deal: "sales",
  product: "shop",
};

/** The paid extension (D748) a kind's pages are part of: a conversation opens in the support desk's inbox, a deal in Deals. */
const RECORD_EXTENSIONS: Partial<Record<RecordKind, ExtensionId>> = { conversation: "support_desk", deal: "deals" };

/** The kinds a person may be offered in a store: they hold the kind's key, its feature is on and the account has its extension. */
export function recordKindsFor(may: (key: PermissionKey) => boolean, features: FeatureSource): RecordKind[] {
  const extensionOk = (kind: RecordKind) => {
    const extension = RECORD_EXTENSIONS[kind];
    return !extension || Array.isArray(features) || storeExtensionOn(features as { extensionFacts?: unknown }, extension);
  };
  return RECORD_KINDS.filter((kind) => may(RECORD_KEYS[kind]) && requirementMet(features, RECORD_FEATURES[kind]) && extensionOk(kind));
}

/** One store's part of a search: the kinds this person may be offered there. */
export type RecordScope = { storeId: string; kinds: readonly RecordKind[] };

export type RecordQuery = {
  /** What was typed, normalised (NFC, spaces collapsed, at most 100 characters). */
  text: string;
  /** `%text%` and `text%` for `lower(column) like lower(…)`: `%`, `_` and `\` typed are literals. */
  contains: string;
  starts: string;
  /** The text when it is an email address, for the exact matches the email indexes serve. */
  email: string | null;
  /**
   * The text as the start of an order number (no `#`, no spaces, upper case, as `orders_number_normalised_idx` keeps it) when it has a digit:
   * `lo` and `hi` bound the index range, `like` checks the start itself, so a range the collation draws wider never finds a wrong order.
   */
  number: { exact: string; lo: string; hi: string | null; like: string } | null;
};

/** What a search looks for, or null when it is too short to look for records. */
export function recordQuery(input: unknown): RecordQuery | null {
  const text = normaliseSearch(input);
  if ([...text].length < RECORD_QUERY_MIN) return null;
  const like = escapeLike(text);
  const bare = text.replace(/^#/, "").replace(/\s+/g, "").toUpperCase();
  return {
    text,
    contains: `%${like}%`,
    starts: `${like}%`,
    email: /^[^\s@]+@[^\s@]+$/.test(text) ? text : null,
    number: /[0-9]/.test(bare) ? numberRange(bare) : null,
  };
}

/** The range of numbers that start with `start`: up to the same start with its last character one higher (none past U+D7FE, to stay valid UTF-8). */
function numberRange(start: string): NonNullable<RecordQuery["number"]> {
  const points = [...start];
  const last = points[points.length - 1].codePointAt(0)!;
  const hi = last < 0xd7ff ? `${points.slice(0, -1).join("")}${String.fromCodePoint(last + 1)}` : null;
  return { exact: start, lo: start, hi, like: `${escapeLike(start)}%` };
}

/** A record found: its kind, its store, the key its page takes, and how well it matched (0 exact, 1 the start, 2 anywhere). */
export type FoundRecord = {
  kind: RecordKind;
  storeId: string;
  key: string;
  title: string | null;
  detail: string | null;
  rank: number;
  /** An order's total. */
  minor: number | null;
  currency: string | null;
};

/** Where a record opens: its own admin page; a customer by the key the customers list uses (their account, else their latest order). */
export function recordHref(kind: RecordKind, storeSlug: string, key: string): string {
  const base = `/admin/${storeSlug}`;
  switch (kind) {
    case "order":
      return `${base}/orders/${key}`;
    case "customer":
      return `${base}/customers/${key}`;
    case "conversation":
      return `${base}/support?c=${key}`;
    case "deal":
      return `${base}/deals/${key}`;
    case "product":
      return `${base}/products/${key}`;
  }
}

/**
 * The records by kind, at most `per` of each, best match first within a kind (a stable sort keeps the reads' recency). A kind holding an exact
 * match comes first (an order number typed puts its order on top, a SKU its product), the rest in `RECORD_KINDS`' order, so the list does not
 * jump about between searches.
 */
export function groupRecords(found: readonly FoundRecord[], per = RECORDS_PER_KIND): { kind: RecordKind; records: FoundRecord[] }[] {
  const groups = RECORD_KINDS.map((kind) => ({
    kind,
    records: found
      .filter((record) => record.kind === kind)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, per),
  })).filter((group) => group.records.length > 0);
  const exact = (group: (typeof groups)[number]) => (group.records[0].rank === 0 ? 0 : 1);
  return groups.sort((a, b) => exact(a) - exact(b));
}

/**
 * The finder's rows for the records found: an order as `#number` with who bought and its total, a customer by name with their email, a
 * conversation by who it is with (or the inbox's *Visitor* label) and its subject, a deal with its customer or company, a product with the
 * SKU that matched. Across stores (the owner's level) each row names its store on the right. A record of a store not given is dropped.
 */
export function recordGroups(
  found: readonly FoundRecord[],
  { storeOf, money, visitor, showStore = false }: {
    storeOf: (storeId: string) => { slug: string; name: string } | undefined;
    money: (minor: number, currency: string) => string;
    visitor: (conversationId: string) => string;
    showStore?: boolean;
  },
): FinderGroup[] {
  return groupRecords(found).map(({ kind, records }) => ({
    kind,
    items: records.flatMap((record) => {
      const store = storeOf(record.storeId);
      if (!store) return [];
      const title = kind === "order" ? `#${record.title ?? ""}` : kind === "conversation" ? (record.title ?? visitor(record.key)) : (record.title ?? "");
      const total = kind === "order" && record.minor !== null && record.currency ? money(record.minor, record.currency) : null;
      const what = [record.detail, total].filter((part): part is string => Boolean(part)).join(" · ");
      return [{ title, group: showStore ? store.name : "", what, href: recordHref(kind, store.slug, record.key) }];
    }),
  })).filter((group) => group.items.length > 0);
}
