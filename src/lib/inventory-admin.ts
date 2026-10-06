/**
 * What the Inventory pages say and decide (wave 3, D172, `docs/wave-3-inventory.md` 2.2 to 2.4), pure: the tabs, the address of a filtered list,
 * what a typed figure comes to, the review list before a save, the words of a save's result and of a row's state. The server's `adjustStock()` holds
 * the same rules again (`resultOf()` under the row lock); this file lets the browser show a person what Save would do, with the same function.
 */

import {
  ADJUST_PROBLEM_WORDS,
  STOCK_MAX,
  isAdjustReason,
  isMovementReason,
  resultOf,
  type AdjustMode,
  type AdjustOutcome,
  type AdjustReason,
  type StockPolicy,
} from "./inventory";

// ---------------------------------------------------------------------------
// Tabs and addresses
// ---------------------------------------------------------------------------

export const INVENTORY_TABS = [
  { id: "list", label: "Inventory", path: "" },
  { id: "history", label: "History", path: "/history" },
  { id: "locations", label: "Locations", path: "/locations" },
  { id: "import", label: "Import", path: "/import" },
  { id: "export", label: "Export", path: "/export" },
] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number]["id"];

/** The addresses of the Inventory pages of a store. */
export const inventoryPaths = (slug: string): Record<InventoryTab, string> => {
  const base = `/admin/${slug}/inventory`;
  return Object.fromEntries(INVENTORY_TABS.map((t) => [t.id, `${base}${t.path}`])) as Record<InventoryTab, string>;
};

export const STATUS_CHOICES = ["all", "low", "out", "backorder", "negative"] as const;
export type StatusChoice = (typeof STATUS_CHOICES)[number];
export const isStatusChoice = (value: unknown): value is StatusChoice => typeof value === "string" && (STATUS_CHOICES as readonly string[]).includes(value);

export const STATUS_WORDS: Record<StatusChoice, string> = {
  all: "All variants",
  low: "At or below the low-stock level",
  out: "Sold out",
  backorder: "Selling on backorder",
  negative: "Below zero",
};

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type ListQuery = { search: string; location: string | null; status: StatusChoice; after: string | null };

/** The list's filter as the address holds it. Anything that is not a known value is no filter; the server checks the location is the store's. */
export function listQuery(params: Record<string, string | string[] | undefined>): ListQuery {
  const location = first(params.location);
  const status = first(params.status);
  const after = first(params.after);
  return {
    search: (first(params.q) ?? "").trim().slice(0, 100),
    location: location && UUID.test(location) ? location.toLowerCase() : null,
    status: isStatusChoice(status) ? status : "all",
    after: after && /^[A-Za-z0-9_-]{1,400}$/.test(after) ? after : null,
  };
}

/** The address of the list with a filter (empty values left out), for the status links, the filter form's reset and the next page. */
export function listHref(base: string, query: Partial<ListQuery>): string {
  const sp = new URLSearchParams();
  if (query.search) sp.set("q", query.search);
  if (query.location) sp.set("location", query.location);
  if (query.status && query.status !== "all") sp.set("status", query.status);
  if (query.after) sp.set("after", query.after);
  const text = sp.toString();
  return text ? `${base}?${text}` : base;
}

export type HistoryQuery = { sku: string; variant: string | null; location: string | null; reason: string | null; from: string | null; to: string | null; after: string | null };

/** The history's filter as the address holds it (the same rule: an unknown value is no filter). */
export function historyQuery(params: Record<string, string | string[] | undefined>): HistoryQuery {
  const variant = first(params.variant);
  const location = first(params.location);
  const reason = first(params.reason);
  const from = first(params.from);
  const to = first(params.to);
  const after = first(params.after);
  return {
    sku: (first(params.sku) ?? "").trim().slice(0, 100),
    variant: variant && UUID.test(variant) ? variant.toLowerCase() : null,
    location: location && UUID.test(location) ? location.toLowerCase() : null,
    reason: reason && isMovementReason(reason) ? reason : null,
    from: from && DAY.test(from) ? from : null,
    to: to && DAY.test(to) ? to : null,
    after: after && /^\d{1,18}$/.test(after) ? after : null,
  };
}

export function historyHref(base: string, query: Partial<HistoryQuery>): string {
  const sp = new URLSearchParams();
  if (query.sku) sp.set("sku", query.sku);
  if (query.variant) sp.set("variant", query.variant);
  if (query.location) sp.set("location", query.location);
  if (query.reason) sp.set("reason", query.reason);
  if (query.from) sp.set("from", query.from);
  if (query.to) sp.set("to", query.to);
  if (query.after) sp.set("after", query.after);
  const text = sp.toString();
  return text ? `${base}?${text}` : base;
}

// ---------------------------------------------------------------------------
// A row's state
// ---------------------------------------------------------------------------

export type RowFigures = {
  onHand: number;
  committed: number;
  available: number;
  owed: number;
  stockPolicy: StockPolicy;
  backorderDays: number | null;
  lowStockThreshold: number | null;
};

export type RowState = "negative" | "backorder" | "out" | "low" | "owed";

/**
 * The marks a row carries, most serious first: below zero, selling on backorder, sold out (nothing left to sell), at or below the low-stock level,
 * owed units. A row can carry several. Never says "in stock" for a variant that has none: only what is true of the figures.
 */
export function rowStates(row: RowFigures): RowState[] {
  const states: RowState[] = [];
  const out = row.available <= 0;
  if (row.onHand < 0) states.push("negative");
  if (out && row.stockPolicy === "continue") states.push("backorder");
  else if (out) states.push("out");
  if (row.lowStockThreshold !== null && row.onHand <= row.lowStockThreshold) states.push("low");
  if (row.owed > 0) states.push("owed");
  return states;
}

export const STATE_WORDS: Record<RowState, string> = {
  negative: "Below zero",
  backorder: "On backorder",
  out: "Sold out",
  low: "Low stock",
  owed: "Owed",
};

/** What a row's marks mean, in a sentence for the title of the mark. */
export const STATE_HELP: Record<RowState, string> = {
  negative: "More has been sold than was on hand. Receive stock or count it to bring it back to zero or above.",
  backorder: "Nothing is left to sell now, and the variant keeps selling with a stated delivery time.",
  out: "Nothing is left to sell now, and the variant stops selling at zero.",
  low: "On hand is at or below the low-stock level set for this variant.",
  owed: "Units sold on backorder on paid orders that have not been sent yet: what the store still has to receive.",
};

/** A figure for a table: a minus sign that is a minus sign, thousands apart. */
export const figureText = (n: number): string => (n < 0 ? `−${Math.abs(n).toLocaleString("en-GB")}` : n.toLocaleString("en-GB"));
/** A change for a table: always signed. */
export const deltaText = (n: number): string => (n > 0 ? `+${n.toLocaleString("en-GB")}` : n < 0 ? `−${Math.abs(n).toLocaleString("en-GB")}` : "0");

/** "Keep selling: 7 days" / "Stop selling at zero". */
export function policyCell(policy: StockPolicy, days: number | null): string {
  return policy === "continue" && days ? `Keep selling: ${days} ${days === 1 ? "day" : "days"}` : policy === "continue" ? "Keep selling" : "Stop selling at zero";
}

// ---------------------------------------------------------------------------
// What the person typed
// ---------------------------------------------------------------------------

/** A cell's typed state: *Set to* (a counted figure) or *Adjust by* (a signed change). Typing in one is meant to clear the other, but both are read the same way. */
export type CellTyped = { set: string; by: string };
export const EMPTY_CELL: CellTyped = { set: "", by: "" };

/**
 * A typed whole number, or null for nothing typed, or `"invalid"`. A sign is allowed (the *Adjust by* box takes a minus and a plus), spaces and a
 * thin space between thousands are not part of the figure, and no decimal is read: stock is counted in whole units.
 */
export function parseTyped(text: string): number | null | "invalid" {
  const t = text.replace(/[\s  ]/g, "").replace("−", "-");
  if (t === "") return null;
  if (!/^[+-]?\d{1,9}$/.test(t)) return "invalid";
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : "invalid";
}

export type CellRef = { key: string; variantId: string; locationId: string; was: number; sku: string; title: string; options: string; location: string };

export type ReviewRow = CellRef & {
  mode: AdjustMode;
  value: number;
  next: number | null;
  delta: number | null;
  /** A sentence when the figure cannot be saved (not a whole number, below zero, over the limit); the row is then not sent. */
  problem: string | null;
};

/**
 * The rows a save would send, from what was typed in each cell: a row is a change only if something was typed and it is not the figure the cell was
 * loaded with. `Adjust by` wins when both are typed. A cell whose result would be refused is still listed, with its sentence, so a person sees it
 * before Save; the rows to send are `sendable()`.
 */
export function reviewRows(cells: readonly CellRef[], typed: Readonly<Record<string, CellTyped>>): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const cell of cells) {
    const t = typed[cell.key];
    if (!t) continue;
    const by = parseTyped(t.by);
    const set = parseTyped(t.set);
    if (by === "invalid" || set === "invalid") {
      rows.push({ ...cell, mode: by === "invalid" ? "adjust" : "set", value: 0, next: null, delta: null, problem: ADJUST_PROBLEM_WORDS.not_whole });
      continue;
    }
    if (by !== null) {
      if (by === 0) continue;
      const worked = resultOf("adjust", by, cell.was);
      rows.push(worked.ok ? { ...cell, mode: "adjust", value: by, next: worked.next, delta: worked.delta, problem: null } : { ...cell, mode: "adjust", value: by, next: null, delta: null, problem: ADJUST_PROBLEM_WORDS[worked.problem] });
      continue;
    }
    if (set !== null) {
      if (set === cell.was) continue;
      const worked = resultOf("set", set, cell.was);
      rows.push(worked.ok ? { ...cell, mode: "set", value: set, next: worked.next, delta: worked.delta, problem: null } : { ...cell, mode: "set", value: set, next: null, delta: null, problem: ADJUST_PROBLEM_WORDS[worked.problem] });
    }
  }
  return rows;
}

/** The rows that can be saved: the ones with no problem of their own. */
export const sendable = (rows: readonly ReviewRow[]): ReviewRow[] => rows.filter((r) => r.problem === null);

/** The body `adjustStock()` takes (checked by `adjustInput` again there). */
export function adjustPayload(rows: readonly ReviewRow[], reason: AdjustReason, note: string) {
  return { reason, note: note.trim() === "" ? null : note.trim(), rows: sendable(rows).map((r) => ({ variantId: r.variantId, locationId: r.locationId, mode: r.mode, value: r.value, was: r.was })) };
}

/** The reasons a person gives, in the order the page offers them, with the sentence under the select. */
export const REASON_CHOICES: { id: AdjustReason; label: string; help: string }[] = [
  { id: "correction", label: "Correction", help: "The figure was wrong." },
  { id: "count", label: "Count", help: "You counted what is on the shelf and the figure is that count." },
  { id: "received", label: "Received", help: "Stock arrived from a supplier." },
  { id: "damaged", label: "Damaged", help: "Units that cannot be sold." },
  { id: "lost", label: "Theft or loss", help: "Units that are gone." },
  { id: "promotion", label: "Promotion or donation", help: "Units given away." },
];

export const reasonChoice = (value: unknown): AdjustReason => (isAdjustReason(value) ? value : "correction");

// ---------------------------------------------------------------------------
// The words of a save
// ---------------------------------------------------------------------------

export type SavedCounts = { written: number; unchanged: number; conflicts: number; refused: number; failed: number };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** One sentence about what a save did, naming only counts. */
export function savedWords(c: SavedCounts): string {
  const parts = [`${plural(c.written, "figure", "figures")} saved`];
  if (c.unchanged > 0) parts.push(`${c.unchanged.toLocaleString("en-GB")} already as typed`);
  if (c.conflicts > 0) parts.push(`${plural(c.conflicts, "figure", "figures")} not saved because the stock had changed`);
  if (c.refused > 0) parts.push(`${c.refused.toLocaleString("en-GB")} refused`);
  if (c.failed > 0) parts.push(`${c.failed.toLocaleString("en-GB")} could not be saved`);
  return `${parts.join(", ")}.`;
}

export const OUTCOME_WORDS: Record<AdjustOutcome, string> = {
  written: "Saved",
  unchanged: "Already that figure",
  conflict: "Not saved: the stock changed",
  refused: "Refused",
  failed: "Could not be saved",
};

/** The limit a typed figure is held to, said under the box. */
export const FIGURE_HINT = `Whole units, at most ${STOCK_MAX.toLocaleString("en-GB")}. A figure never goes below 0 by a person's change: only a sale of a variant that keeps selling on backorder takes it below.`;

/** The note box's hint: staff text about stock, not about a person. */
export const NOTE_HINT = "A short note for the history. Do not write about a person.";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** "12 units across 3 variants" for a location's line. */
export const heldWords = (units: number, variants: number): string => `${plural(units, "unit", "units")} across ${plural(variants, "variant", "variants")}`;

// ---------------------------------------------------------------------------
// An order's stock: where its units came from, where they go back
// ---------------------------------------------------------------------------

export type StockPart = { locationId: string; quantity: number };
export type NamedLocation = { id: string; name: string; active: boolean };

const nameOf = (locations: readonly NamedLocation[], id: string): string => locations.find((l) => l.id === id)?.name ?? "A location";

/** "Oslo 2, Bergen 1": where the units of an order line were taken from (its `sale` movements), in the order the locations are ranked. Empty when nothing is recorded. */
export function takenFromWords(taken: readonly StockPart[], locations: readonly NamedLocation[]): string {
  const rank = new Map(locations.map((l, i) => [l.id, i]));
  return [...taken]
    .filter((p) => p.quantity > 0)
    .sort((a, b) => (rank.get(a.locationId) ?? 1e9) - (rank.get(b.locationId) ?? 1e9))
    .map((p) => `${nameOf(locations, p.locationId)} ${p.quantity}`)
    .join(", ");
}

/**
 * Where a restock goes when nobody chooses (spec 2.6), said in words for the refund dialog: back to the location each unit was taken from, less what
 * already went back there; a location that is no longer active gives its units to the first active one. With nothing recorded the first active location
 * takes them. `locations` are in rank order. The server's `restockPlan()` decides; this only tells what it will do.
 */
export function putBackWords(taken: readonly StockPart[], returned: readonly StockPart[], locations: readonly NamedLocation[]): string {
  const firstActive = locations.find((l) => l.active);
  if (!firstActive) return "";
  const left = new Map<string, number>();
  for (const p of taken) left.set(p.locationId, (left.get(p.locationId) ?? 0) + p.quantity);
  for (const p of returned) left.set(p.locationId, (left.get(p.locationId) ?? 0) - p.quantity);
  // In the order the locations are ranked, not the order the movements were read in.
  const rank = new Map(locations.map((l, i) => [l.id, i]));
  const parts = [...left.entries()].filter(([, n]) => n > 0).sort((a, b) => (rank.get(a[0]) ?? 1e9) - (rank.get(b[0]) ?? 1e9));
  if (taken.length === 0) return `No record of where these were taken from: they go back to ${firstActive.name}.`;
  if (parts.length === 0) return `Everything taken has already gone back: any more goes to ${firstActive.name}.`;
  const words = parts.map(([id, n]) => `${nameOf(locations, id)} ${n}`).join(", ");
  const moved = parts.filter(([id]) => !locations.find((l) => l.id === id)?.active).map(([id]) => nameOf(locations, id));
  return moved.length > 0
    ? `Taken from ${words}. ${moved.join(" and ")} ${moved.length === 1 ? "is" : "are"} not active, so those units go back to ${firstActive.name}.`
    : `They go back where they were taken from: ${words}.`;
}

/** The id typed in a refund form's "Put back at" select; empty for "where it was taken from", else a UUID (the server checks it is an active location of the store). */
export function putBackChoice(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
