/**
 * The Orders list's words in a language (D312 A4): the parts of `order-list.ts`, `order-list-admin.ts`, `order-bulk.ts` and `order-list-row.ts` that write a sentence,
 * written again from the `orders` catalogue. The libraries keep their own English for their other readers (the AI manager's tools, the tests); the screens read these,
 * with the English catalogue unless given, which says the same as the libraries do. Pure, so the client table uses it too.
 */
import { countWords, fillWords } from "./admin-fill";
import { ordersEn, type OrdersMessages } from "./admin-messages/orders.en";
import type { BulkRefusal, BulkReason, BulkResult } from "./order-bulk";
import { ORDERS_COUNT_CAP } from "./order-limits";
import type { OrderListItem } from "./order-list-row";
import type { OrderListKey, OrderListParams } from "./order-list";

/** What each filter chip says, as `describeFilters()` does. */
export function filterChips(params: OrderListParams, w: OrdersMessages["filters"] = ordersEn.filters): { key: OrderListKey; label: string }[] {
  const p = params;
  const c = w.chips;
  const out: { key: OrderListKey; label: string }[] = [];
  const named = (list: readonly string[], labels: Record<string, string>) => list.map((v) => labels[v] ?? v.replace(/_/g, " ")).join(", ");
  // The English chips name the codes as they are written (`partially refunded`); another language uses the filter's own words.
  const plain = (list: readonly string[]) => list.map((v) => v.replace(/_/g, " ")).join(", ");
  const english = w === ordersEn.filters;
  if (p.q !== "") out.push({ key: "q", label: fillWords(c.search, { value: p.q }) });
  if (p.pay.length > 0) out.push({ key: "pay", label: fillWords(c.payment, { value: english ? plain(p.pay) : named(p.pay, w.pay) }) });
  if (p.ship.length > 0) out.push({ key: "ship", label: fillWords(c.fulfilment, { value: english ? plain(p.ship) : named(p.ship, w.ship) }) });
  if (p.status.length > 0) out.push({ key: "status", label: fillWords(c.status, { value: english ? plain(p.status) : named(p.status, w.statuses) }) });
  if (p.tag.length > 0) out.push({ key: "tag", label: fillWords(c.tagged, { value: p.tag.join(", ") }) });
  if (p.range) out.push({ key: "range", label: fillWords(c.placed, { value: w.ranges[p.range] }) });
  else if (p.from || p.to) out.push({ key: "from", label: fillWords(c.between, { from: p.from ?? "…", to: p.to ?? "…" }) });
  if (p.market) out.push({ key: "market", label: fillWords(c.market, { value: p.market }) });
  if (p.source) out.push({ key: "source", label: fillWords(c.source, { value: w.sources[p.source] }) });
  if (p.gift) out.push({ key: "gift", label: c.gifts });
  if (p.archived !== "no") out.push({ key: "archived", label: p.archived === "yes" ? c.archivedOnly : c.includingArchived });
  return out;
}

/** "37 orders", or "10,000+ orders" when the count reached its cap, as `matchingText()` does, in a language's own number format. */
export function matchingWords(count: number, capped: boolean, w: OrdersMessages["list"] = ordersEn.list, locale = "en"): string {
  return capped ? fillWords(w.capped, { n: ORDERS_COUNT_CAP.toLocaleString(locale) }) : countWords(count, w.matching, { n: count.toLocaleString(locale) });
}

/** "Applied to 41 of 43 orders", as `bulkSummary()` does. */
export const appliedWords = (result: Pick<BulkResult, "requested" | "applied">, w: OrdersMessages["bulk"] = ordersEn.bulk): string =>
  countWords(result.requested, w.applied, { applied: result.applied });

/** The refusals grouped by reason, as `groupRefusals()` does, each with its reason in the language. */
export function refusalGroups(refused: readonly BulkRefusal[], w: OrdersMessages["bulk"] = ordersEn.bulk): { reason: BulkReason; text: string; orders: BulkRefusal[] }[] {
  const groups = new Map<BulkReason, BulkRefusal[]>();
  for (const r of refused) groups.set(r.reason, [...(groups.get(r.reason) ?? []), r]);
  return [...groups].map(([reason, orders]) => ({ reason, text: w.reasons[reason], orders }));
}

/** What the fulfilment cell says, as `shipWords()` does. */
export function shipCellWords(item: Pick<OrderListItem, "ship" | "delivery">, w: OrdersMessages["table"] = ordersEn.table): string {
  const method = item.delivery?.method ?? "ship";
  if (method === "pickup") {
    if (item.ship === "to_send" || item.ship === "partly_sent") return item.delivery?.ready ? w.readyForPickup : w.toHandOver;
    if (item.ship === "sent") return w.collected;
  }
  if (method === "local") {
    if (item.ship === "to_send" || item.ship === "partly_sent") return w.toDeliver;
    if (item.ship === "sent") return w.takenOut;
  }
  return w.ship[item.ship];
}
