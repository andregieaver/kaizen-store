import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { vatIncluded } from "@/lib/checkout";
import { crossesBorder } from "@/lib/duties";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";

import type { Account } from "./auth";
import { decideCustoms, loadCustomsFacts } from "./customs";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { loadTaxFacts } from "./tax-treatment";
import { col, typedRows } from "./typed-rows";

/**
 * The AI manager's customs and duties (wave 7 unit I, D343): `customs_duties` reads, for one of the store's countries, who pays duties there (the
 * store's DDP or DAP), and for its products whether each has an HS code and origin and what one of it at its current price there would pay in duty
 * and import VAT, worked out by the cart's own decision (`decideCustoms()`, with no shipping). Read-only; every figure is an estimate from the
 * platform's rates table and is said to be one; the model never makes a rate or an amount.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

/** How many products an answer covers. */
const LIMIT = 30;

const PRODUCT_ROW = z.object({
  handle: col.text,
  title: col.text,
  variant_id: col.uuid,
  amount: col.minorOrNull,
  vat_rate: col.decimal,
});

export async function customsDutiesTool({ store }: Ctx, input: OwnerToolInput<"customs_duties">) {
  const code = input.country.trim().toUpperCase();
  const market = store.keptMarkets.find((m) => m.code === code);
  if (!market) return fail(`${code} is not one of the store's countries: see list_markets or Settings, Countries.`);
  const tax = await loadTaxFacts(db(), { storeId: store.id, market: { code }, cartId: null });
  const handles = (input.products ?? []).map((h) => h.trim()).filter(Boolean);
  // Each active product's first shipped variant, at its current price in that country (in the country's own currency).
  const rows = await typedRows(
    PRODUCT_ROW,
    sql`
      select p.handle, coalesce((select t.title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1), p.handle) as title,
        v.id as variant_id, cp.amount_minor as amount, commerce.vat_rate(${code}, p.vat_category) as vat_rate
      from commerce.products p
      join lateral (
        select pv.id from commerce.product_variants pv
        where pv.store_id = p.store_id and pv.product_id = p.id and pv.active and pv.delivery = 'physical'
        order by pv.sku limit 1
      ) first on true
      join commerce.product_variants v on v.store_id = p.store_id and v.id = first.id
      left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${code}
      where p.store_id = ${store.id}::uuid and p.status = 'active'
        and (${handles.length === 0} or p.handle = any(${`{${handles.map((h) => `"${h.replace(/["\\]/g, "")}"`).join(",")}}`}::text[]))
      order by p.handle
      limit ${LIMIT}
    `,
  );
  const facts = await loadCustomsFacts(db(), { storeId: store.id, market: { code }, variantIds: rows.map((r) => r.variant_id), tax });
  const money = (minor: number) => formatMoney(minor, market.nativeCurrency, "en-GB");
  const ioss = Boolean(tax.profile.iossNumber && tax.profile.iossMarkets.includes(code));
  const products = rows.map((r) => {
    const v = facts.variants.get(r.variant_id);
    const base = { handle: r.handle, title: r.title, hs_code: v?.hsCode ?? null, origin: v?.origin ?? null };
    if (r.amount === null) return { ...base, estimate: null, why_none: "Not priced in this country." };
    const outcome = decideCustoms(facts, {
      lines: [{ key: "0", variantId: r.variant_id, title: r.title, quantity: 1, shipped: true, totalMinor: r.amount, taxMinor: vatIncluded(r.amount, r.vat_rate), rate: r.vat_rate }],
      shippingMinor: 0,
      shippingTaxMinor: 0,
      currency: market.nativeCurrency,
      ioss,
      fallback: null,
    });
    const e = outcome.estimate;
    if (e.kind === "none") return { ...base, price: money(r.amount), estimate: null, why_none: "No customs border is crossed." };
    if (e.kind === "unknown") return { ...base, price: money(r.amount), estimate: null, why_none: e.reason };
    return {
      ...base,
      price: money(r.amount),
      estimate: { duty: money(e.dutyMinor), import_vat_at_border: money(e.importVatMinor), collected_at_checkout_with_ddp: money(e.ddpMinor), carrier_may_collect_with_dap: money(e.dapMinor), verified: e.verified, sources: e.sources },
    };
  });
  return {
    country: code,
    sent_from: facts.dispatch,
    crosses_customs_border: crossesBorder(facts.dispatch, code),
    who_pays: facts.chosen === "ddp" ? "DDP: collected at checkout with the order" : "DAP: the recipient pays the carrier on delivery",
    rates_in_table: facts.rows.length > 0,
    products,
    products_without_hs_code: products.filter((p) => !p.hs_code).length,
    note:
      "Every amount is an estimate for one item at its price in that country, without shipping, from the platform's own rates table (each rate with its source; verified only where a person checked it). why_none: missing_hs (the product has no HS code: add it in the product editor), no_rate (the table has no rate for its heading), not_in_table (the country is not in the table), no_currency_rate, no_dispatch (the store has not said where goods are sent from). With DDP a product without an HS code cannot be bought in that country. The choice is on Settings, Customs and duties.",
    page: `/admin/${store.slug}/settings/customs`,
  };
}
