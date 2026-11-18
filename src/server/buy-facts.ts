import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { mollieAppOn } from "./mollie";
import { refreshTag } from "./refresh";
import { catalogTag } from "./catalog";
import { platformModes } from "./stripe-keys";
import { col, typedRow } from "./typed-rows";

/**
 * What only an owner sets about buying, in one cached read per store and market (bloat review step 2.13): the checkout's look, the
 * payment state, the Stripe account, Klarna's switches, checkout fields, quote mode, back in stock, price breaks and producer
 * schemes. The product page reads it beside its other cached reads, so it is part of the prerendered page (Next's use-cache guide:
 * an in-memory entry does not persist between serverless requests, so it rides in the prerender). Stock, the shopper's sign-in and
 * buyer kind, list prices and the environment (platformModes(), mollieAppOn()) are never in it: `paymentsOnOf()` and `providerOf()`
 * apply the environment after the read. A writer of one of its tables calls `refreshBuyFacts()` (`buy-writers.scan.test.ts`).
 */

export const BUY_PLATFORM_TAG = "buy-platform";
export const buyTag = (storeId: string) => "buy:" + storeId;

export type BuyFacts = {
  checkoutUi: "custom" | "hosted";
  paymentsRow: boolean;
  activeMode: "test" | "live" | null;
  onMollie: boolean;
  starter: boolean;
  accountId: string | null;
  klarnaOff: boolean;
  klarnaActive: boolean;
  checkoutFields: boolean;
  quoteMode: string;
  backInStock: boolean;
  hasBreaks: boolean;
  hasSchemes: boolean;
};

const FACTS_ROW = z.object({
  checkout_ui: col.textOrNull,
  payments_on: col.bool,
  active_mode: col.textOrNull,
  on_mollie: col.bool,
  starter: col.bool,
  account_id: col.textOrNull,
  klarna_off: col.bool,
  klarna_active: col.bool,
  checkout_fields: col.bool,
  quote_mode: col.text,
  back_in_stock: col.bool,
  has_breaks: col.bool,
  has_schemes: col.bool,
});

export async function buyFacts(storeId: string, marketCode: string): Promise<BuyFacts> {
  "use cache";
  cacheLife("hours");
  cacheTag(buyTag(storeId), catalogTag(storeId), BUY_PLATFORM_TAG);
  const row = await typedRow(
    FACTS_ROW,
    sql`
      select
        (select checkout_ui from commerce.platform_settings limit 1) as checkout_ui,
        exists (
          select 1 from commerce.payment_providers p
          where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.enabled
            and (p.active_mode = 'test' or exists (
              select 1 from commerce.stripe_accounts a
              where a.store_id = p.store_id and a.mode = p.active_mode and a.card_payments = 'active'
            ))
        ) as payments_on,
        (select active_mode from commerce.payment_providers
          where store_id = ${storeId}::uuid and provider = 'stripe') as active_mode,
        exists (
          select 1 from commerce.payment_providers p
          join commerce.checkout_providers c on c.store_id = p.store_id and c.mode = p.active_mode and c.provider = 'mollie'
          join commerce.mollie_connections m on m.store_id = p.store_id and m.revoked_at is null
          where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.enabled
        ) as on_mollie,
        exists (select 1 from commerce.stores s where s.id = ${storeId}::uuid and s.starter) as starter,
        (select a.account_id
          from commerce.payment_providers p
          join commerce.stripe_accounts a
            on a.store_id = p.store_id and a.mode = p.active_mode and a.card_payments = 'active'
          where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.enabled) as account_id,
        exists (
          select 1 from commerce.payment_methods
          where store_id = ${storeId}::uuid and market_code = ${marketCode} and method = 'klarna' and not enabled
        ) as klarna_off,
        coalesce((
          select a.method_states -> 'klarna_payments' ->> 'status' = 'active'
          from commerce.stripe_accounts a
          join commerce.payment_providers p on p.store_id = a.store_id and p.provider = 'stripe' and a.mode = p.active_mode
          where a.store_id = ${storeId}::uuid
        ), false) as klarna_active,
        exists (select 1 from commerce.checkout_fields where store_id = ${storeId}::uuid and enabled) as checkout_fields,
        coalesce((select quote_requests from commerce.order_settings where store_id = ${storeId}::uuid), 'off') as quote_mode,
        exists (
          select 1 from commerce.automations a join commerce.stores s on s.id = a.store_id
          where a.store_id = ${storeId}::uuid and a.kind = 'back_in_stock' and a.enabled
            and commerce.store_is_active(a.store_id) and not (s.is_template or s.starter)
        ) as back_in_stock,
        (exists (select 1 from commerce.price_breaks where store_id = ${storeId}::uuid)
          or exists (select 1 from commerce.price_list_breaks where store_id = ${storeId}::uuid)) as has_breaks,
        exists (select 1 from commerce.product_schemes where store_id = ${storeId}::uuid) as has_schemes
    `,
  );
  return {
    checkoutUi: row?.checkout_ui === "hosted" ? "hosted" : "custom",
    paymentsRow: row?.payments_on ?? false,
    activeMode: row?.active_mode === "test" || row?.active_mode === "live" ? row.active_mode : null,
    onMollie: row?.on_mollie ?? false,
    starter: row?.starter ?? false,
    accountId: row?.account_id ?? null,
    klarnaOff: row?.klarna_off ?? false,
    klarnaActive: row?.klarna_active ?? false,
    checkoutFields: row?.checkout_fields ?? false,
    quoteMode: row?.quote_mode ?? "off",
    backInStock: row?.back_in_stock ?? false,
    hasBreaks: row?.has_breaks ?? false,
    hasSchemes: row?.has_schemes ?? false,
  };
}

/** A writer of a table behind the facts calls this after its write has committed. */
export function refreshBuyFacts(storeId: string): void {
  refreshTag(buyTag(storeId));
}

/** The platform's own setting (the checkout's look) changed: every store's facts are stale. */
export function refreshBuyPlatform(): void {
  refreshTag(BUY_PLATFORM_TAG);
}

/** Whether checkout can start, as getCheckoutInfo() works it out: the facts, then the environment (never cached). */
export function paymentsOnOf(f: BuyFacts): boolean {
  return !f.starter && ((f.paymentsRow && (f.activeMode !== "test" || platformModes().includes("test"))) || (f.onMollie && mollieAppOn()));
}

/** Whose page the shopper pays on (D292), as getCheckoutInfo() says. */
export function providerOf(f: BuyFacts): "mollie" | "stripe" {
  return f.onMollie && mollieAppOn() ? "mollie" : "stripe";
}
