import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { EMPTY_COPY } from "@/lib/shopify-copy";
import { EMPTY_MOVE } from "@/lib/shopify-move";
import { REDIRECT_BULK_DELETE_MAX } from "@/lib/data-limits";
import { normaliseEmail } from "@/lib/email-address";

import { audit, type Membership } from "./auth";
import { deleteDiscount } from "./discounts";
import { deactivateGiftCard } from "./gift-cards-admin";
import { log } from "./log";
import { deleteMenu } from "./menus";
import { deletePage, pagesTag } from "./pages";
import { memberCan } from "./permissions";
import { setArchived } from "./products";
import { deleteRedirects } from "./redirects";
import { refreshTag } from "./refresh";
import { setMarkets } from "./setup";
import { currentStore, storeTag } from "./stores";
import { removeInstall } from "./theme-installs";
import { col, typedRows } from "./typed-rows";
import { pgTextArray, pgUuidArray } from "./pg-arrays";
import { db } from "@/db/client";

/**
 * *Undo this copy* (D445 step 9, `docs/moving-from-shopify.md` 8.4, the owner's choice: remove or switch off). Everything a move from Shopify
 * makes is written down as it is made (`commerce.shop_move_items`, this module its only writer); the undo takes exactly that back and nothing
 * the owner made: copied orders, pages, menus, discount codes, redirects, subscribers and customers removed; products archived; gift cards
 * switched off; the countries it added taken away again; the theme it added removed. Only before the store's first real order (an order that
 * is not a copy), and never an email to anyone. Shipping rates it wrote stay (harmless, and the owner's to change). The owner's.
 */

const OWNER = "owner" as const;

export type MoveItemKind = "job" | "customer" | "product" | "page" | "menu" | "discount" | "subscriber" | "gift_card" | "theme" | "market";

/** A customer's mark: the md5 of their address in lower case, so the record never holds an address. */
export const customerMark = (email: string): string => createHash("md5").update(normaliseEmail(email)).digest("hex");

/** Writes down what a move made (idempotent). */
export async function recordMoveItems(storeId: string, kind: MoveItemKind, refs: readonly string[]): Promise<void> {
  const clean = [...new Set(refs.filter((r) => typeof r === "string" && r.length > 0 && r.length <= 300))];
  for (let i = 0; i < clean.length; i += 500) {
    const part = clean.slice(i, i + 500);
    await db().execute(sql`
      insert into commerce.shop_move_items (store_id, kind, ref)
      select ${storeId}::uuid, ${kind}, r from unnest(${pgTextArray(part)}::text[]) r
      on conflict do nothing
    `);
  }
}

const ITEM = z.object({ kind: col.text, ref: col.text });
const ID = z.object({ id: col.uuid });

/** What the move made, each kind's ids here (the imports' rows read from their own items). */
async function madeBy(storeId: string): Promise<Record<"products" | "orders" | "redirects" | "customers" | Exclude<MoveItemKind, "job" | "customer" | "product">, string[]>> {
  const items = await typedRows(ITEM, sql`select kind, ref from commerce.shop_move_items where store_id = ${storeId}::uuid`);
  const of = (kind: MoveItemKind) => items.filter((i) => i.kind === kind).map((i) => i.ref);
  const jobs = of("job").filter((j) => /^[0-9a-f-]{36}$/i.test(j));
  const ids = async (query: ReturnType<typeof sql>) => (await typedRows(ID, query)).map((r) => r.id);
  const jobList = sql.join(jobs.map((j) => sql`${j}::uuid`), sql`, `);
  const marks = of("customer");
  return {
    // By handle, as the copy wrote down the products not here before its import ran (an item's `drafted` does not say which were new).
    products: of("product").length
      ? await ids(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = any(${pgTextArray(of("product"))}::text[])`)
      : [],
    orders: jobs.length
      ? await ids(sql`select o.id from commerce.orders o join commerce.data_job_items i on o.copied_from = md5(${storeId} || ':history:' || i.ref)::uuid
                       where o.store_id = ${storeId}::uuid and i.store_id = ${storeId}::uuid and i.job_id in (${jobList}) and i.kind = 'order' and i.outcome = 'created'`)
      : [],
    redirects: jobs.length
      ? await ids(sql`select r.id from commerce.redirects r join commerce.data_job_items i on i.store_id = r.store_id and i.ref = r.source
                       where r.store_id = ${storeId}::uuid and i.job_id in (${jobList}) and i.kind = 'redirect' and i.outcome = 'created'`)
      : [],
    customers: marks.length
      ? await ids(sql`select id from commerce.customers where store_id = ${storeId}::uuid and md5(lower(email)) = any(${pgTextArray(marks.filter((m) => /^[0-9a-f]{32}$/.test(m)))}::text[])`)
      : [],
    page: of("page"),
    menu: of("menu"),
    discount: of("discount"),
    subscriber: of("subscriber"),
    gift_card: of("gift_card"),
    theme: of("theme"),
    market: of("market"),
  };
}

export type UndoView = { allowed: boolean; reason: "real_orders" | "nothing" | null; counts: Record<string, number> };

/** Whether the copy can be undone, and what it would take back (owner only). Null when there is no Shopify move. */
export async function undoView(member: Membership): Promise<UndoView | null> {
  if (!memberCan(member, OWNER)) return null;
  const storeId = member.store.id;
  const made = await madeBy(storeId);
  const counts = Object.fromEntries(Object.entries(made).map(([k, v]) => [k, v.length]));
  const any = Object.values(counts).some((n) => n > 0);
  const [real] = await typedRows(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid and copied_from is null`);
  if ((real?.n ?? 0) > 0) return { allowed: false, reason: "real_orders", counts };
  return { allowed: any, reason: any ? null : "nothing", counts };
}

export type UndoResult = { ok: true; removed: number; kept: number } | { ok: false; problem: "real_orders" | "nothing" | "forbidden" };

/**
 * Takes back what the move made. Each thing through its own writer; one that cannot go (a customer something else now refers to) is kept and
 * counted. The copy and the move are cleared, so Copy can start again; the connection to Shopify stays. Audited with the counts.
 */
export async function undoCopy(member: Membership): Promise<UndoResult> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "forbidden" };
  const view = await undoView(member);
  if (!view?.allowed) return { ok: false, problem: view?.reason === "real_orders" ? "real_orders" : "nothing" };
  const storeId = member.store.id;
  const made = await madeBy(storeId);
  let removed = 0;
  let kept = 0;
  const count = (ok: boolean) => (ok ? (removed += 1) : (kept += 1));

  // Copied orders first (a copied order may be deleted; a real one never is).
  for (const id of made.orders) {
    const ok = await db()
      .transaction(async (tx) => (await tx.execute<Record<string, unknown>>(sql`select commerce.delete_copied_order(${storeId}::uuid, ${id}::uuid) as ok`))[0]?.ok === true)
      .catch((error: unknown) => {
        log("warn", "shopify.undo_order_kept", { storeId }, error);
        return false;
      });
    count(ok);
  }
  // Gift cards are never deleted: switched off, and no longer tied to a person the undo removes.
  for (const id of made.gift_card) {
    const off = await deactivateGiftCard(storeId, member.account.id, id, "Undo of the Shopify copy");
    await db().execute(sql`update commerce.gift_cards set customer_id = null where store_id = ${storeId}::uuid and id = ${id}::uuid and moved_from is not null`);
    count(off.ok);
  }
  if (made.subscriber.length) {
    const rows = await db().execute(sql`delete from commerce.marketing_subscribers where store_id = ${storeId}::uuid and source = 'shopify' and id = any(${pgUuidArray(made.subscriber)}::uuid[]) returning id`);
    removed += rows.length;
    kept += made.subscriber.length - rows.length;
  }
  for (const id of made.customers) {
    // One at a time: a customer something else now refers to (a booking, a note) stays.
    const ok = await db()
      .transaction(async (tx) => (await tx.execute(sql`delete from commerce.customers where store_id = ${storeId}::uuid and id = ${id}::uuid returning id`)).length > 0)
      .catch(() => false);
    count(ok);
  }
  for (const id of made.products) count(await setArchived(member.store, id, true, member.account).catch(() => false));
  for (const id of made.page) count(await deletePage(member.account, member.store.id, id, "page").catch(() => false) || (await deletePage(member.account, member.store.id, id, "article").catch(() => false)));
  refreshTag(pagesTag(storeId));
  for (const id of made.menu) count(await deleteMenu(member.account.id, storeId, id).catch(() => false));
  for (const id of made.discount) count((await deleteDiscount(member, id).catch(() => ({ ok: false }))).ok);
  for (let i = 0; i < made.redirects.length; i += REDIRECT_BULK_DELETE_MAX) {
    const part = made.redirects.slice(i, i + REDIRECT_BULK_DELETE_MAX);
    const done = await deleteRedirects(member, part);
    if (done.ok) {
      removed += done.deleted;
      kept += part.length - done.deleted;
    } else kept += part.length;
  }
  for (const id of made.theme) count((await removeInstall(storeId, id, member.account.id).catch(() => ({ ok: false }))).ok);
  if (made.market.length) {
    const fresh = (await currentStore(member.store.slug)) ?? member.store;
    const keep = fresh.markets.map((m) => m.code).filter((c) => !made.market.includes(c));
    const back = keep.length > 0 ? await setMarkets({ ...member, store: fresh }, keep) : { ok: false };
    if (back.ok) removed += made.market.length;
    else kept += made.market.length;
  }
  refreshTag(storeTag(member.store.slug));

  await db().execute(sql`delete from commerce.shop_move_items where store_id = ${storeId}::uuid`);
  await db().execute(sql`
    update commerce.shop_moves set copy = ${JSON.stringify(EMPTY_COPY)}::jsonb, move = ${JSON.stringify(EMPTY_MOVE)}::jsonb, updated_at = now()
     where store_id = ${storeId}::uuid and status = 'connected'
  `);
  await audit(member.account.id, storeId, "integration.shopify_copy_undone", { removed, kept });
  log("info", "shopify.copy_undone", { storeId, removed, kept });
  return { ok: true, removed, kept };
}
