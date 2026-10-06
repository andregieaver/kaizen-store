import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import {
  ADJUST_PROBLEM_WORDS,
  HISTORY_PAGE_SIZE,
  INVENTORY_PAGE_SIZE,
  adjustInput,
  bulkPolicyInput,
  byWords,
  isMovementReason,
  policyProblem,
  resultOf,
  type AdjustOutcome,
  type MovementReason,
  type StockPolicy,
} from "@/lib/inventory";

import { setBased } from "./analytics-totals";
import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { withStockContext } from "./stock-context";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The Inventory page's reads and writes (wave 3, D172, `docs/wave-3-inventory.md` 2.2). Every statement carries the store id. A person's change of a
 * level goes through `adjustStock()` only: it locks the row, compares the figure the row was loaded with, works the new figure out from the figure under
 * the lock and writes it with its reason and note as ONE movement (`withStockContext()`); each row is its own transaction, so a row that conflicts or
 * fails never stops the others. Nothing here deletes anything.
 */

const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const uuidList = (ids: readonly string[]): SQL => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export const INVENTORY_STATUSES = ["all", "low", "out", "backorder", "negative"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export type InventoryFilter = {
  /** Title, handle or SKU. */
  search?: string;
  /** One location (its figures, active or not); null or absent: every ACTIVE location summed. */
  locationId?: string | null;
  status?: InventoryStatus;
  /** The cursor of the page before (`nextCursor`). */
  after?: string | null;
  limit?: number;
};

/** One location's figures for a variant: on hand, held by checkouts in progress, and what is left (can be negative on a backorder). */
export type LocationFigures = { locationId: string; name: string; active: boolean; hasLevel: boolean; onHand: number; committed: number; available: number };

export type InventoryRow = {
  variantId: string;
  productId: string;
  handle: string;
  title: string;
  productStatus: string;
  options: Record<string, string>;
  sku: string;
  /** Over the active locations (or the chosen location). `committed` is the live checkout holds only: a paid order has already drawn its units. */
  onHand: number;
  committed: number;
  available: number;
  /** Backordered units on paid orders that are not sent yet: what the store still has to receive. */
  owed: number;
  stockPolicy: StockPolicy;
  backorderDays: number | null;
  lowStockThreshold: number | null;
  /** Each location's figures, for the row's disclosure (every active location, and an inactive one that holds a level). */
  locations: LocationFigures[];
};

export type InventoryCounts = { variants: number; low: number; out: number; owed: number; negative: number };

export type InventoryPage = {
  rows: InventoryRow[];
  nextCursor: string | null;
  counts: InventoryCounts;
  locations: { id: string; name: string; active: boolean; priority: number }[];
  /** The filter as it was applied, with the location checked to be the store's. */
  applied: { search: string; locationId: string | null; status: InventoryStatus };
};

type Cursor = [string, string, string];
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(parsed) && parsed.length === 3 && parsed.every((x) => typeof x === "string") ? (parsed as Cursor) : null;
  } catch {
    return null;
  }
}

/**
 * The variants the page lists: active goods that are shipped, of an active or draft product, with their figures. The figures are worked out for
 * all of the store's such variants in one pass (a CTE of the levels and the live holds per variant) and the filter, the order and the page cut
 * after, so a store with thousands of variants answers in one query.
 */
function figuresCte(storeId: string, locationId: string | null): SQL {
  return sql`
    holds as (
      select variant_id, location_id, sum(quantity)::int as held
      from commerce.inventory_reservations
      where store_id = ${storeId}::uuid and released_at is null and expires_at > now()
      group by variant_id, location_id
    ),
    cells as (
      select l.variant_id, l.on_hand, coalesce(h.held, 0) as held
      from commerce.inventory_levels l
      join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
      left join holds h on h.variant_id = l.variant_id and h.location_id = l.location_id
      where l.store_id = ${storeId}::uuid
        ${locationId ? sql`and l.location_id = ${locationId}::uuid` : sql`and loc.active`}
    ),
    sums as (
      select variant_id, sum(on_hand)::int as on_hand, sum(held)::int as held from cells group by variant_id
    ),
    owed as (
      select ol.variant_id, sum(ol.backorder_quantity)::int as owed
      from commerce.order_lines ol
      join commerce.orders o on o.store_id = ol.store_id and o.id = ol.order_id
      where ol.store_id = ${storeId}::uuid and ol.backorder_quantity > 0 and o.status = 'paid' and o.copied_from is null
      group by ol.variant_id
    ),
    listed as (
      select v.id as variant_id, v.product_id, v.sku, v.options, v.stock_policy, v.backorder_days, v.low_stock_threshold,
             p.handle, p.status as product_status,
             coalesce(s.on_hand, 0) as on_hand, coalesce(s.held, 0) as held, coalesce(w.owed, 0) as owed
      from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      left join sums s on s.variant_id = v.id
      left join owed w on w.variant_id = v.id
      where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical' and p.kind = 'goods' and p.status in ('active', 'draft')
    )`;
}

const STATUS_WHERE: Record<InventoryStatus, SQL> = {
  all: sql`true`,
  low: sql`low_stock_threshold is not null and on_hand <= low_stock_threshold`,
  // Nothing to sell now: the free units (never below zero) are none.
  out: sql`on_hand - held <= 0`,
  backorder: sql`stock_policy = 'continue' and on_hand - held <= 0`,
  negative: sql`on_hand < 0`,
};

export async function inventoryPage(store: Pick<Store, "id" | "localization">, filter: InventoryFilter = {}): Promise<InventoryPage> {
  const storeId = store.id;
  const locationRows = await db().execute<Row>(sql`
    select id, name, active, priority from commerce.inventory_locations
    where store_id = ${storeId}::uuid order by active desc, priority, created_at, id
  `);
  const locations = locationRows.map((l) => ({ id: String(l.id), name: String(l.name), active: Boolean(l.active), priority: Number(l.priority) }));
  // A location that is not the store's is no filter at all.
  const locationId = filter.locationId && locations.some((l) => l.id === filter.locationId) ? filter.locationId : null;
  const status = filter.status && (INVENTORY_STATUSES as readonly string[]).includes(filter.status) ? filter.status : "all";
  const search = (filter.search ?? "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? INVENTORY_PAGE_SIZE), 1), 200);
  const cursor = decodeCursor(filter.after);
  const locale = store.localization.locales[0] ?? "en";
  const like = escapeLike(search);

  const page = await setBased<Row>(sql`
    with ${figuresCte(storeId, locationId)},
    titled as (
      select l.*, coalesce(tl.title, tf.title, l.handle) as title
      from listed l
      left join commerce.product_translations tl on tl.product_id = l.product_id and tl.locale = ${locale}
      left join lateral (select title from commerce.product_translations where product_id = l.product_id order by locale limit 1) tf on true
    )
    select * from titled
    where ${STATUS_WHERE[status]}
      ${search ? sql`and (handle ilike ${like} or sku ilike ${like} or title ilike ${like})` : sql``}
      ${cursor ? sql`and (handle, sku, variant_id) > (${cursor[0]}, ${cursor[1]}, ${cursor[2]}::uuid)` : sql``}
    order by handle, sku, variant_id
    limit ${limit + 1}
  `);
  const more = page.length > limit;
  const shown = page.slice(0, limit);

  // The disclosure's figures: each location of each row, in one query for the page.
  const perLocation = shown.length
    ? await db().execute<Row>(sql`
        select l.variant_id, l.location_id, l.on_hand,
               coalesce((select sum(r.quantity)::int from commerce.inventory_reservations r
                          where r.store_id = l.store_id and r.variant_id = l.variant_id and r.location_id = l.location_id
                            and r.released_at is null and r.expires_at > now()), 0) as held
        from commerce.inventory_levels l
        where l.store_id = ${storeId}::uuid and l.variant_id in (${uuidList(shown.map((r) => String(r.variant_id)))})
      `)
    : [];
  const levelAt = new Map(perLocation.map((r) => [`${r.variant_id}:${r.location_id}`, { onHand: Number(r.on_hand), held: Number(r.held) }]));

  const rows: InventoryRow[] = shown.map((r) => {
    const variantId = String(r.variant_id);
    const figures: LocationFigures[] = locations
      .map((l): LocationFigures | null => {
        const level = levelAt.get(`${variantId}:${l.id}`);
        // An inactive location shows only when it holds a level.
        if (!level && !l.active) return null;
        const onHand = level?.onHand ?? 0;
        const committed = level?.held ?? 0;
        return { locationId: l.id, name: l.name, active: l.active, hasLevel: Boolean(level), onHand, committed, available: onHand - committed };
      })
      .filter((x): x is LocationFigures => x !== null);
    return {
      variantId,
      productId: String(r.product_id),
      handle: String(r.handle),
      title: String(r.title),
      productStatus: String(r.product_status),
      options: (r.options ?? {}) as Record<string, string>,
      sku: String(r.sku),
      onHand: Number(r.on_hand),
      committed: Number(r.held),
      available: Number(r.on_hand) - Number(r.held),
      owed: Number(r.owed),
      stockPolicy: r.stock_policy === "continue" ? "continue" : "deny",
      backorderDays: r.backorder_days === null ? null : Number(r.backorder_days),
      lowStockThreshold: r.low_stock_threshold === null ? null : Number(r.low_stock_threshold),
      locations: figures,
    };
  });
  const last = shown.at(-1);
  return {
    rows,
    nextCursor: more && last ? encodeCursor([String(last.handle), String(last.sku), String(last.variant_id)]) : null,
    counts: await inventoryCounts(storeId),
    locations,
    applied: { search, locationId, status },
  };
}

/** The counts above the list: variants, those at or below their low-stock level, sold out, owed units, and variants below zero (over the active locations). */
export async function inventoryCounts(storeId: string): Promise<InventoryCounts> {
  const [row] = await setBased<Row>(sql`
    with ${figuresCte(storeId, null)}
    select count(*)::int as variants,
           count(*) filter (where ${STATUS_WHERE.low})::int as low,
           count(*) filter (where ${STATUS_WHERE.out})::int as out,
           coalesce(sum(owed), 0)::int as owed,
           count(*) filter (where ${STATUS_WHERE.negative})::int as negative
    from listed
  `);
  return { variants: Number(row?.variants ?? 0), low: Number(row?.low ?? 0), out: Number(row?.out ?? 0), owed: Number(row?.owed ?? 0), negative: Number(row?.negative ?? 0) };
}

// ---------------------------------------------------------------------------
// Adjusting
// ---------------------------------------------------------------------------

export type AdjustRowResult = {
  variantId: string;
  locationId: string;
  outcome: AdjustOutcome;
  /** The figure the row was loaded with, and what the stored figure was under the lock. */
  was: number;
  before: number | null;
  after: number | null;
  /** For a refused, conflicting or failed row: a sentence. */
  problem: string | null;
};

export type AdjustResult =
  | { ok: true; written: number; unchanged: number; conflicts: number; refused: number; failed: number; rows: AdjustRowResult[] }
  | { ok: false; problems: string[] };

export type StockSource = "inventory_page" | "ai_manager";

const refusedWords = {
  not_found: "This variant or location is not in this store, or the variant is not goods that are shipped.",
  stock_negative: ADJUST_PROBLEM_WORDS.negative,
  failed: "The stock could not be saved. Try again.",
} as const;

/**
 * Saves the Inventory page's changes with a reason: each row on its own transaction (a conflict, a refusal or a failure of one never stops the
 * others). A row is a CONFLICT when the stored figure under the row lock is not the one it was loaded with (a sale, another person's count): it is
 * not written and says what the stored figure is. The new figure is worked out from the figure under the lock (`resultOf()`), so a sale between the
 * page's load and Save is never undone, and a person never takes a level below zero (only a sale of a variant that keeps selling on backorder does).
 * One audit entry per save: the number of rows and the reason, never a SKU list. `products:write`.
 */
export async function adjustStock(member: Membership, raw: unknown, source: StockSource = "inventory_page"): Promise<AdjustResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const parsed = adjustInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const { reason, note, rows } = parsed.data;
  const storeId = member.store.id;
  // Rows are written in (variant, location) order: the order every level writer locks in.
  const ordered = [...rows].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0));
  const results: AdjustRowResult[] = [];
  for (const row of ordered) {
    const base = { variantId: row.variantId, locationId: row.locationId, was: row.was };
    try {
      const result = await db().transaction(async (tx): Promise<AdjustRowResult> => {
        const [target] = await tx.execute<Row>(sql`
          select v.id from commerce.product_variants v
          join commerce.inventory_locations loc on loc.store_id = v.store_id and loc.id = ${row.locationId}::uuid
          where v.store_id = ${storeId}::uuid and v.id = ${row.variantId}::uuid and v.delivery = 'physical'
        `);
        if (!target) return { ...base, outcome: "refused", before: null, after: null, problem: refusedWords.not_found };
        const [level] = await tx.execute<Row>(sql`
          select on_hand from commerce.inventory_levels
          where store_id = ${storeId}::uuid and variant_id = ${row.variantId}::uuid and location_id = ${row.locationId}::uuid
          for update
        `);
        const now = level ? Number(level.on_hand) : 0;
        if (now !== row.was) {
          return { ...base, outcome: "conflict", before: now, after: null, problem: `The stock is ${now} now, not ${row.was} as when the page was opened. Nothing was changed for this row.` };
        }
        const worked = resultOf(row.mode, row.value, now);
        if (!worked.ok) return { ...base, outcome: "refused", before: now, after: null, problem: ADJUST_PROBLEM_WORDS[worked.problem] };
        if (worked.delta === 0) return { ...base, outcome: "unchanged", before: now, after: now, problem: null };
        await withStockContext(tx, { reason, source, accountId: member.account.id, note }, () =>
          tx.execute(sql`
            insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
            values (${storeId}::uuid, ${row.variantId}::uuid, ${row.locationId}::uuid, ${worked.next})
            on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
          `),
        );
        return { ...base, outcome: "written", before: now, after: worked.next, problem: null };
      });
      results.push(result);
    } catch (error) {
      console.error("[inventory] a row could not be saved", error);
      results.push({ ...base, outcome: "failed", before: null, after: null, problem: refusedWords.failed });
    }
  }
  const count = (outcome: AdjustOutcome) => results.filter((r) => r.outcome === outcome).length;
  const written = count("written");
  if (written > 0) {
    await audit(member.account.id, storeId, "products.inventory_adjusted", { rows: written, reason, unchanged: count("unchanged"), conflicts: count("conflict"), source }, { area: "products" }).catch((error) =>
      console.error("[inventory] the adjustment could not be logged", error),
    );
    refreshTag(catalogTag(storeId));
  }
  return { ok: true, written, unchanged: count("unchanged"), conflicts: count("conflict"), refused: count("refused"), failed: count("failed"), rows: results };
}

// ---------------------------------------------------------------------------
// Policy and the warning level, in bulk
// ---------------------------------------------------------------------------

export type PolicyResult = { ok: true; changed: number; unchanged: number; problems: string[] } | { ok: false; problems: string[] };

/**
 * The selected variants' policy or warning level (the Inventory page's bulk actions). The rules are the editor's (`policyProblem()`, and the database
 * holds them again): goods that are shipped only, the days required with `continue` and absent without it. Each variant is its own statement; a variant
 * that is not goods or not the store's is listed and left. Turning a variant back to `deny` while its stock is negative is allowed (a rise is always
 * allowed, a sale is not). One audit entry `products.stock_policy_changed` with counts. `products:write`.
 */
export async function setVariantPolicies(member: Membership, raw: unknown): Promise<PolicyResult> {
  if (!memberCan(member, "products:write")) return { ok: false, problems: [NO_ACCESS] };
  const parsed = bulkPolicyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const { variantIds, change } = parsed.data;
  const storeId = member.store.id;
  let changed = 0;
  let unchanged = 0;
  const problems: string[] = [];
  for (const id of [...variantIds].sort()) {
    const [v] = await db().execute<Row>(sql`
      select sku, delivery::text as delivery, stock_policy, backorder_days, low_stock_threshold from commerce.product_variants
      where store_id = ${storeId}::uuid and id = ${id}::uuid
    `);
    if (!v) {
      problems.push("A variant is not in this store.");
      continue;
    }
    const next =
      change.kind === "continue"
        ? { stockPolicy: "continue" as const, backorderDays: change.backorderDays, lowStockThreshold: v.low_stock_threshold === null ? null : Number(v.low_stock_threshold) }
        : change.kind === "deny"
          ? { stockPolicy: "deny" as const, backorderDays: null, lowStockThreshold: v.low_stock_threshold === null ? null : Number(v.low_stock_threshold) }
          : { stockPolicy: (v.stock_policy === "continue" ? "continue" : "deny") as StockPolicy, backorderDays: v.backorder_days === null ? null : Number(v.backorder_days), lowStockThreshold: change.lowStockThreshold };
    const problem = policyProblem(next, v.delivery === "digital" || v.delivery === "service" ? (v.delivery as "digital" | "service") : "physical");
    if (problem) {
      problems.push(`${String(v.sku)}: ${problem}`);
      continue;
    }
    const same =
      next.stockPolicy === (v.stock_policy === "continue" ? "continue" : "deny") &&
      next.backorderDays === (v.backorder_days === null ? null : Number(v.backorder_days)) &&
      next.lowStockThreshold === (v.low_stock_threshold === null ? null : Number(v.low_stock_threshold));
    if (same) {
      unchanged += 1;
      continue;
    }
    await db().execute(sql`
      update commerce.product_variants
         set stock_policy = ${next.stockPolicy}, backorder_days = ${next.backorderDays}, low_stock_threshold = ${next.lowStockThreshold}
       where store_id = ${storeId}::uuid and id = ${id}::uuid
    `);
    changed += 1;
  }
  if (changed > 0) {
    await audit(member.account.id, storeId, "products.stock_policy_changed", { variants: changed, change: change.kind, ...(change.kind === "continue" ? { days: change.backorderDays } : {}) }, { area: "products" }).catch((error) =>
      console.error("[inventory] the policy change could not be logged", error),
    );
    refreshTag(catalogTag(storeId));
  }
  return { ok: true, changed, unchanged, problems };
}

// ---------------------------------------------------------------------------
// The history
// ---------------------------------------------------------------------------

export type HistoryFilter = {
  variantId?: string | null;
  /** A SKU, exactly (case-insensitively). */
  sku?: string | null;
  locationId?: string | null;
  reason?: string | null;
  /** Days as `YYYY-MM-DD` in the store's time zone; `to` is the last day included (the range ends at the next local midnight). */
  from?: string | null;
  to?: string | null;
  after?: string | null;
  limit?: number;
};

export type HistoryRow = {
  id: string;
  createdAt: string;
  variantId: string;
  productId: string | null;
  handle: string | null;
  title: string;
  options: Record<string, string>;
  sku: string;
  locationId: string;
  location: string;
  delta: number;
  onHandAfter: number;
  reason: MovementReason | "other";
  by: string;
  note: string | null;
  orderId: string | null;
  returnId: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The movements of the store, newest first, paged by id. A movement holds no personal data (an account id, an order id, a note about stock), and
 * the staff member's NAME is read from the account only for display. Kept 24 months. The range's end is the store's next local midnight after the
 * last day (the date plus one, never an interval on a timestamp).
 */
export async function stockHistory(store: Pick<Store, "id" | "timeZone" | "localization">, filter: HistoryFilter = {}): Promise<{ rows: HistoryRow[]; nextCursor: string | null }> {
  const storeId = store.id;
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? HISTORY_PAGE_SIZE), 1), 200);
  const locale = store.localization.locales[0] ?? "en";
  const tz = store.timeZone || "Europe/Oslo";
  const afterId = filter.after && /^\d{1,18}$/.test(filter.after) ? filter.after : null;
  const reason = filter.reason && isMovementReason(filter.reason) ? filter.reason : null;
  const from = filter.from && DAY.test(filter.from) ? filter.from : null;
  const to = filter.to && DAY.test(filter.to) ? filter.to : null;
  const sku = filter.sku?.trim() ? filter.sku.trim() : null;
  const rows = await db().execute<Row>(sql`
    select m.id, m.created_at, m.variant_id, m.location_id, m.delta, m.on_hand_after, m.reason, m.source, m.note, m.order_id, m.return_id,
           v.sku, v.options, p.id as product_id, p.handle, coalesce(tl.title, tf.title, p.handle, v.sku) as title,
           loc.name as location, a.name as actor_name, o.number as order_number, r.number as return_number
    from commerce.inventory_movements m
    join commerce.product_variants v on v.store_id = m.store_id and v.id = m.variant_id
    join commerce.inventory_locations loc on loc.store_id = m.store_id and loc.id = m.location_id
    left join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join commerce.accounts a on a.id = m.actor_account_id
    left join commerce.orders o on o.store_id = m.store_id and o.id = m.order_id
    left join commerce.returns r on r.store_id = m.store_id and r.id = m.return_id
    where m.store_id = ${storeId}::uuid
      ${filter.variantId ? sql`and m.variant_id = ${filter.variantId}::uuid` : sql``}
      ${sku ? sql`and lower(v.sku) = lower(${sku})` : sql``}
      ${filter.locationId ? sql`and m.location_id = ${filter.locationId}::uuid` : sql``}
      ${reason ? sql`and m.reason = ${reason}` : sql``}
      ${from ? sql`and m.created_at >= ((${from}::date)::timestamp at time zone ${tz})` : sql``}
      ${to ? sql`and m.created_at < (((${to}::date + 1))::timestamp at time zone ${tz})` : sql``}
      ${afterId ? sql`and m.id < ${afterId}::bigint` : sql``}
    order by m.id desc
    limit ${limit + 1}
  `);
  const shown = rows.slice(0, limit);
  return {
    rows: shown.map((r) => ({
      id: String(r.id),
      createdAt: new Date(String(r.created_at)).toISOString(),
      variantId: String(r.variant_id),
      productId: r.product_id ? String(r.product_id) : null,
      handle: r.handle ? String(r.handle) : null,
      title: String(r.title),
      options: (r.options ?? {}) as Record<string, string>,
      sku: String(r.sku),
      locationId: String(r.location_id),
      location: String(r.location),
      delta: Number(r.delta),
      onHandAfter: Number(r.on_hand_after),
      reason: isMovementReason(r.reason) ? r.reason : "other",
      by: byWords({ source: String(r.source), actorName: r.actor_name ? String(r.actor_name) : null, orderNumber: r.order_number ? String(r.order_number) : null, returnNumber: r.return_number ? String(r.return_number) : null }),
      note: r.note ? String(r.note) : null,
      orderId: r.order_id ? String(r.order_id) : null,
      returnId: r.return_id ? String(r.return_id) : null,
    })),
    nextCursor: rows.length > limit && shown.length > 0 ? String(shown[shown.length - 1].id) : null,
  };
}

// ---------------------------------------------------------------------------
// What a location holds
// ---------------------------------------------------------------------------

export type LocationImpact = {
  /** Units on hand at the location (what stops being for sale when it is deactivated; a negative level is owed stock, not units). */
  units: number;
  /** Variants with units at it. */
  variants: number;
  /** Units held at it by checkouts in progress. */
  committedUnits: number;
  /** What was owed on backorder at it (negative levels), as units. */
  owedUnits: number;
};

/**
 * What deactivating a location would take off sale, read the same way the dialog and the action both read it, so the figure the owner confirms is
 * the figure the server checks: units on hand (positive levels), variants, and the live holds. Null for a location that is not the store's.
 */
export async function locationImpact(reader: Pick<ReturnType<typeof db>, "execute">, storeId: string, locationId: string): Promise<LocationImpact | null> {
  const [loc] = await reader.execute<Row>(sql`select id from commerce.inventory_locations where store_id = ${storeId}::uuid and id = ${locationId}::uuid`);
  if (!loc) return null;
  const [levels] = await reader.execute<Row>(sql`
    select coalesce(sum(greatest(on_hand, 0)), 0)::int as units,
           count(*) filter (where on_hand > 0)::int as variants,
           coalesce(sum(greatest(-on_hand, 0)), 0)::int as owed
    from commerce.inventory_levels where store_id = ${storeId}::uuid and location_id = ${locationId}::uuid
  `);
  const [held] = await reader.execute<Row>(sql`
    select coalesce(sum(quantity), 0)::int as held from commerce.inventory_reservations
    where store_id = ${storeId}::uuid and location_id = ${locationId}::uuid and released_at is null and expires_at > now()
  `);
  return { units: Number(levels?.units ?? 0), variants: Number(levels?.variants ?? 0), committedUnits: Number(held?.held ?? 0), owedUnits: Number(levels?.owed ?? 0) };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export type LedgerProblem = { variantId: string; locationId: string; onHand: number; moved: number };

/**
 * The (variant, location) pairs where the movements do not add up to the level (`commerce.inventory_ledger_check()`): empty when the history is
 * whole. A pair listed here means a level was written in a way no trigger saw, which the database makes impossible; `store_checkup` says so if it happens.
 */
export async function ledgerProblems(storeId: string): Promise<LedgerProblem[]> {
  const rows = await db().execute<Row>(sql`select variant_id, location_id, on_hand, moved from commerce.inventory_ledger_check(${storeId}::uuid) limit 50`);
  return rows.map((r) => ({ variantId: String(r.variant_id), locationId: String(r.location_id), onHand: Number(r.on_hand), moved: Number(r.moved) }));
}
