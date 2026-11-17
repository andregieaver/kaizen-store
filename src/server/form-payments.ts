import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { shownOptions, t } from "@/lib/i18n";
import { shown, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { variantLabel } from "@/lib/product-input";
import { marketPath } from "@/lib/paths";

import { CATALOG_TAG, catalogTag } from "./catalog";
import { changeLine } from "./cart";
import { formsTag } from "./form-site";
import { log } from "./log";
import { getCheckoutInfo } from "./orders";
import { marketIn } from "./shop";
import { getOpenStore, storeSlugOf } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Payments in a form (D738 F6c, `docs/forms.md` 15.3). A store's message form may name one of its product variants; once a response is kept,
 * that variant goes into the visitor's cart in the page's market and the visitor goes on to the store's own checkout, where it is paid as any
 * order: its price there, its VAT, its terms and right of withdrawal, the order number, the invoice and the books. The response remembers the
 * cart (`form_payments`), so the order placed from that cart after the response is the response's order. Nothing here takes money.
 */

/** What a form's payment is, for the page that shows the form: the product's name and its price in the market, or null (none, or not sold there). */
export type FormPaymentOffer = { title: string; price: string };

const OFFER_ROW = z.object({ id: col.uuid, title: col.text, options: z.record(z.string(), z.string()).nullable(), amount_minor: col.minor });

/**
 * What a form may be paid with: a store's goods, physical or digital, sold once (not a booking, a subscription-only product or a host's
 * listing), active with a price in the market. The checkout decides the rest, as for any order.
 */
const PAYABLE = sql`p.status = 'active' and v.active and p.kind = 'goods' and p.host_id is null and not p.subscription_only`;

function offerSql(storeId: string, marketCode: string, locale: string, where: ReturnType<typeof sql>, limit: number) {
  return sql`
    select v.id, coalesce(tl.title, tf.title, p.handle) as title, v.options, cp.amount_minor
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${marketCode}
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    where v.store_id = ${storeId}::uuid and ${PAYABLE} and ${where}
    order by title, v.sku
    limit ${limit}
  `;
}

const offerOf = (row: z.output<typeof OFFER_ROW>, market: Market): FormPaymentOffer & { variantId: string } => {
  const options = variantLabel(shownOptions(t(market.lang), row.options ?? {}));
  return { variantId: row.id, title: options ? `${row.title} (${options})` : row.title, price: formatMoney(shown(market, row.amount_minor), market.currency, market.locale) };
};

/**
 * The product a form's visitors pay for, as the page shows it: only while the product can be paid with (`PAYABLE`) in that market and payments
 * are on there. Whether it can be bought now (stock, what is sold where) is the cart's own check when the form is sent.
 */
export async function formPaymentOffer(storeId: string, variantId: string | null | undefined, marketRef: string | undefined): Promise<FormPaymentOffer | null> {
  "use cache";
  // Prices and products change under the catalogue's tag, the form under its own; whether payments are on is read again when the form is sent.
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId), formsTag(storeId));
  if (!variantId || !z.uuid().safeParse(variantId).success) return null;
  const store = await storeOf(storeId);
  const market = store ? marketIn(store, marketRef) : undefined;
  if (!store || !market) return null;
  const row = await typedRow(OFFER_ROW, offerSql(storeId, market.code, market.locale, sql`v.id = ${variantId}::uuid`, 1));
  if (!row || !(await getCheckoutInfo(storeId, market.code)).paymentsOn) return null;
  const { title, price } = offerOf(row, market);
  return { title, price };
}

/** The editor's choice of product (F6c): a store's payable variants whose name or SKU holds the words, in its first market. */
export async function formPaymentChoices(storeId: string, query: string): Promise<(FormPaymentOffer & { variantId: string })[]> {
  const store = await storeOf(storeId);
  const market = store?.markets[0];
  const q = query.trim().slice(0, 80);
  if (!store || !market || q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await typedRows(
    OFFER_ROW,
    offerSql(storeId, market.code, market.locale, sql`(lower(v.sku) like lower(${like}) or lower(coalesce(tl.title, tf.title, p.handle)) like lower(${like}))`, 10),
  );
  return rows.map((r) => offerOf(r, market));
}

/** The chosen product as the editor names it, or null when it is gone or can no longer be paid with. */
export async function formPaymentChosen(storeId: string, variantId: string | null | undefined): Promise<(FormPaymentOffer & { variantId: string }) | null> {
  if (!variantId) return null;
  const store = await storeOf(storeId);
  const market = store?.markets[0];
  if (!store || !market) return null;
  const row = await typedRow(OFFER_ROW, offerSql(storeId, market.code, market.locale, sql`v.id = ${variantId}::uuid`, 1));
  return row ? offerOf(row, market) : null;
}

async function storeOf(storeId: string) {
  const slug = await storeSlugOf(storeId);
  return slug ? getOpenStore(slug) : null;
}

/**
 * After a response is kept: the form's variant goes into the visitor's cart in the page's market (`changeLine()`, with the cart cookie), and the
 * response is linked to that cart in the same transaction. Answers the checkout's address, or null when the payment cannot start (payments off
 * there, the product not sold or out of stock, the store closed): the response is kept all the same, and the owner sees it unpaid.
 */
export async function startFormPayment(storeId: string, variantId: string, marketRef: string | undefined, responseId: string): Promise<string | null> {
  try {
    const store = await storeOf(storeId);
    const market = store ? marketIn(store, marketRef) : undefined;
    if (!store || !market) return null;
    if (!(await getCheckoutInfo(storeId, market.code)).paymentsOn) return null;
    const added = await changeLine({ storeId, market }, variantId, 1, "add", null, async (tx, cartId) => {
      await tx.execute(sql`
        insert into commerce.form_payments (response_id, store_id, cart_id, variant_id)
        values (${responseId}::uuid, ${storeId}::uuid, ${cartId}::uuid, ${variantId}::uuid)
      `);
    });
    if (added.outcome !== "added" && added.outcome !== "capped") {
      log("info", "forms.payment_not_started", { store: storeId, outcome: added.outcome });
      return null;
    }
    return marketPath(store.slug, market.slug, "/checkout");
  } catch (error) {
    log("error", "forms.payment_start_failed", { store: storeId }, error);
    return null;
  }
}

/** Where a response's payment stands: not asked, waiting (the visitor went to the checkout), or paid with its order's number. */
export type ResponsePayment = { state: "waiting" } | { state: "paid"; orderId: string; number: string };

const PAYMENT_ROW = z.object({ response_id: col.uuid, order_id: col.textOrNull, number: col.textOrNull });

/**
 * The payments of responses, by response: the first paid order placed from its cart after the response (paid, fulfilled or closed), else
 * waiting. An order of the cart that is only placed, held (authorised, D289) or cancelled leaves it waiting.
 */
export async function responsePayments(storeId: string, responseIds: readonly string[]): Promise<Map<string, ResponsePayment>> {
  const out = new Map<string, ResponsePayment>();
  if (responseIds.length === 0) return out;
  const rows = await typedRows(
    PAYMENT_ROW,
    sql`
      select fp.response_id, o.id as order_id, o.number
      from commerce.form_payments fp
      left join lateral (
        select o.id, o.number from commerce.orders o
        where o.store_id = fp.store_id and o.cart_id = fp.cart_id and o.created_at >= fp.created_at and o.status in ('paid', 'fulfilled', 'closed')
        order by o.created_at limit 1
      ) o on true
      where fp.store_id = ${storeId}::uuid and fp.response_id in (select jsonb_array_elements_text(${JSON.stringify(responseIds)}::jsonb)::uuid)
    `,
  );
  for (const r of rows) out.set(r.response_id, r.order_id && r.number ? { state: "paid", orderId: r.order_id, number: r.number } : { state: "waiting" });
  return out;
}
