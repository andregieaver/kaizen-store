import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { todayIn } from "@/lib/analytics-period";
import { policyProblem, reasonWord, type AdjustReason } from "@/lib/inventory";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { STOCK_LEVEL_NOTES, dayBefore, pickLocation, shapeLevel, shapeMovement } from "@/lib/stock-tools";

import type { Membership } from "./auth";
import { adjustStock, inventoryPage, setVariantPolicies, stockHistory } from "./inventory";
import { listLocations } from "./inventory-locations";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The AI manager's stock tools (wave 3, D172, `docs/wave-3-inventory.md` 5.5). The two reads answer from the Inventory page's own functions
 * (`inventoryPage()`, `stockHistory()`): every figure is the store's own, counted in code, and the model repeats it. The two changes are the page's own
 * services with the person behind them: `set_stock` is `adjustStock()` (a reason, one movement, a conflict when the figure moved), `set_backorder` is
 * `setVariantPolicies()` (the editor's rules), both kept for the owner's yes first and checked again when approved. Neither works anything out by itself:
 * a `set_stock` of a figure that is the figure already is refused as nothing to do, and an ambiguous location is a question, never a guess.
 */

type Ctx = {
  account: Membership["account"];
  store: Store;
  holder?: Pick<Membership, "role" | "kind" | "permissions">;
};

/** The member the tool works for, as the services take it: the assistant's own holder, or an owner for a run with none. */
const memberOf = (ctx: Ctx): Membership => ({ account: ctx.account, store: ctx.store, role: ctx.holder?.role ?? "owner", kind: ctx.holder?.kind, permissions: ctx.holder?.permissions });

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

type Variant = { id: string; productId: string; sku: string };

/** The one shipped variant with this SKU: what the old `set_stock` asked for, and the words it refused with. */
async function variantBySku(store: Store, sku: string): Promise<Variant> {
  const rows = await db().execute<Row>(sql`
    select v.id, v.product_id, v.sku from commerce.product_variants v
    where v.store_id = ${store.id}::uuid and v.active and v.delivery = 'physical' and lower(v.sku) = lower(${sku})
  `);
  if (rows.length === 0) return fail(`No shipped variant with the SKU ${sku}. Use stock_levels or get_product for SKUs.`);
  if (rows.length > 1) return fail(`More than one variant has the SKU ${sku}: set it on the product page.`);
  return { id: String(rows[0].id), productId: String(rows[0].product_id), sku: String(rows[0].sku) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The Inventory page, as the model reads it. */
export async function stockLevelsTool(ctx: Ctx, { search, status, location, limit }: OwnerToolInput<"stock_levels">) {
  const store = ctx.store;
  const locations = await listLocations(store.id);
  let locationId: string | null = null;
  if (location) {
    const picked = pickLocation(location, locations);
    if (!picked.ok) return fail(picked.problem);
    locationId = picked.location.id;
  }
  const page = await inventoryPage(store, { search, status, locationId, limit });
  const placeNote = locationId ? `These are the figures of ${page.locations.find((l) => l.id === locationId)?.name ?? "one location"} only.` : "These are the figures over the active locations.";
  return {
    counts: {
      variants: page.counts.variants,
      at_or_below_their_warning_level: page.counts.low,
      sold_out: page.counts.out,
      owed_units: page.counts.owed,
      below_zero: page.counts.negative,
    },
    shown: page.rows.length,
    more_variants_match: page.nextCursor !== null,
    variants: page.rows.map((r) => shapeLevel(r, adminLink(store, `/products/${r.productId}`))),
    locations: page.locations.map((l, i) => ({ name: l.name, active: l.active, rank: i + 1 })),
    notes: [placeNote, ...STOCK_LEVEL_NOTES],
    pages: { inventory: adminLink(store, "/inventory"), history: adminLink(store, "/inventory/history"), locations: adminLink(store, "/inventory/locations") },
  };
}

/** One variant's movements. */
export async function stockHistoryTool(ctx: Ctx, { sku, days, reason, limit }: OwnerToolInput<"stock_history">) {
  const store = ctx.store;
  const variant = await variantBySku(store, sku);
  const from = dayBefore(todayIn(new Date(), store.timeZone || "Europe/Oslo"), days - 1);
  const { rows, nextCursor } = await stockHistory(store, { variantId: variant.id, reason, from, limit });
  return {
    sku: variant.sku,
    period: `the last ${days} days, today included`,
    changes: rows.map((m) => shapeMovement(m)),
    more_changes_exist: nextCursor !== null,
    note: rows.length === 0 ? "No change of this variant's stock was recorded in that time." : "Newest first. The history is kept 24 months.",
    pages: { history: adminLink(store, `/inventory/history?variant=${variant.id}`) },
  };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

type Target = { variant: Variant; location: { id: string; name: string; active: boolean }; was: number; several: boolean };

/** The variant and the location a `set_stock` is for, and the figure there now; a refusal in words when either cannot be told. */
async function stockTarget(ctx: Ctx, input: { sku: string; location?: string | undefined }): Promise<Target> {
  const store = ctx.store;
  const variant = await variantBySku(store, input.sku);
  const locations = await listLocations(store.id);
  const picked = pickLocation(input.location, locations);
  if (!picked.ok) return fail(picked.problem);
  const [level] = await db().execute<Row>(sql`
    select on_hand from commerce.inventory_levels
    where store_id = ${store.id}::uuid and variant_id = ${variant.id}::uuid and location_id = ${picked.location.id}::uuid
  `);
  return { variant, location: picked.location, was: level ? Number(level.on_hand) : 0, several: locations.filter((l) => l.active).length > 1 };
}

/**
 * Sets one variant's figure at one location, the way the Inventory page does: `adjustStock()` with the figure the tool read, so a sale between the read and
 * the write is a conflict that changes nothing and says what the figure is now. The reason and note are kept in the history with the account that asked.
 */
export async function setStockTool(ctx: Ctx, input: OwnerToolInput<"set_stock">) {
  const target = await stockTarget(ctx, input);
  const { variant, location, was } = target;
  const saved = await adjustStock(
    memberOf(ctx),
    { reason: input.reason, note: input.note ?? null, rows: [{ variantId: variant.id, locationId: location.id, mode: "set", value: input.quantity, was }] },
    "ai_manager",
  );
  if (!saved.ok) return fail(saved.problems.join(" "));
  const row = saved.rows[0];
  if (!row) return fail("The stock could not be saved. Try again.");
  if (row.outcome === "conflict" || row.outcome === "refused" || row.outcome === "failed") return fail(row.problem ?? "The stock could not be saved. Try again.");
  const at = target.several || input.location ? ` at ${location.name}` : "";
  return {
    done: row.outcome === "unchanged" ? `${variant.sku} already had ${input.quantity} in stock${at}: nothing was changed.` : `${variant.sku} now has ${input.quantity} in stock${at}.`,
    sku: variant.sku,
    location: location.name,
    before: row.before,
    after: row.after,
    reason: reasonWord(input.reason as AdjustReason),
    admin: adminLink(ctx.store, `/products/${variant.productId}`),
    history: adminLink(ctx.store, `/inventory/history?variant=${variant.id}`),
  };
}

/** Units owed on backorder for one variant, as the Inventory page counts them (paid orders not yet sent). */
async function owedOf(store: Store, variantId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select coalesce(sum(least(ol.backorder_quantity, commerce.line_to_send(ol.id))), 0)::int as owed
    from commerce.order_lines ol join commerce.orders o on o.store_id = ol.store_id and o.id = ol.order_id
    where ol.store_id = ${store.id}::uuid and ol.variant_id = ${variantId}::uuid and ol.backorder_quantity > 0 and o.status = 'paid' and o.copied_from is null
  `);
  return Number(row?.owed ?? 0);
}

/** Turns "keep selling when sold out" on, with its delivery time, or off: `setVariantPolicies()`, the page's own bulk action, for one variant. */
export async function setBackorderTool(ctx: Ctx, { sku, policy, days }: OwnerToolInput<"set_backorder">) {
  const variant = await variantBySku(ctx.store, sku);
  const result = await setVariantPolicies(memberOf(ctx), {
    variantIds: [variant.id],
    change: policy === "continue" ? { kind: "continue", backorderDays: days } : { kind: "deny" },
  });
  if (!result.ok) return fail(result.problems.join(" "));
  if (result.problems.length > 0) return fail(result.problems.join(" "));
  const owed = policy === "deny" ? await owedOf(ctx.store, variant.id) : 0;
  const notes = owed > 0 ? [`${owed} ${owed === 1 ? "unit is" : "units are"} still owed to customers on orders already paid and not sent: those orders still need the goods.`] : [];
  const done =
    result.changed === 0
      ? `${variant.sku} was already set that way: nothing was changed.`
      : policy === "continue"
        ? `${variant.sku} now keeps selling when it is sold out, and shoppers are told it is expected to ship within ${days} ${days === 1 ? "day" : "days"}.`
        : `${variant.sku} now stops selling when it is sold out.`;
  return { done, sku: variant.sku, ...(notes.length > 0 ? { notes } : {}), admin: adminLink(ctx.store, `/products/${variant.productId}`), inventory: adminLink(ctx.store, "/inventory") };
}

/**
 * Checks a gated call before it is kept for approval: what could not be done is refused now, in words, and a change that is no change is not kept either, so the
 * owner is never asked to approve what cannot be done or does nothing.
 */
export async function preflightStockTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<void> {
  if (name === "set_stock") {
    const target = await stockTarget(ctx, { sku: String(input.sku ?? ""), location: input.location ? String(input.location) : undefined });
    const quantity = Number(input.quantity);
    if (target.was === quantity) return fail(`${target.variant.sku} already has ${quantity} in stock at ${target.location.name}: nothing to change.`);
    return;
  }
  if (name !== "set_backorder") return;
  const variant = await variantBySku(ctx.store, String(input.sku ?? ""));
  const policy = input.policy === "continue" ? "continue" : "deny";
  const days = input.days === undefined || input.days === null ? null : Number(input.days);
  const problem = policyProblem({ stockPolicy: policy, backorderDays: days }, "physical");
  if (problem) return fail(problem);
  const [row] = await db().execute<Row>(sql`select stock_policy, backorder_days from commerce.product_variants where store_id = ${ctx.store.id}::uuid and id = ${variant.id}::uuid`);
  const now = row?.stock_policy === "continue" ? "continue" : "deny";
  const nowDays = row?.backorder_days === null || row?.backorder_days === undefined ? null : Number(row.backorder_days);
  if (now === policy && nowDays === days) return fail(`${variant.sku} is already set that way: nothing to change.`);
}
