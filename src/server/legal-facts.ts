import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assembleLegalFacts, type LegalFacts } from "@/lib/legal-facts";
import { marketPath } from "@/lib/paths";
import { carrierInfo } from "@/lib/shipping-carriers";

import { chatWidgetFor } from "./chat-agent";
import { getReturnSettings } from "./return-settings";
import { listCarriers } from "./shipping-carriers";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The store's tax facts for the legal texts: its VAT number and whether it is registered for VAT, from its tax profile
 * (`commerce.store_tax_profile`, D157). A store that has not filled the profile in has no row and is not known either way (null):
 * the imprint and the terms then show `[[Add: VAT number]]`; one that says it is not registered is known to be unregistered.
 */
export async function taxFactsOf(storeId: string): Promise<{ vatNumber: string | null; registered: boolean | null } | null> {
  const [row] = await db().execute<Row>(sql`
    select vat_registered, vat_number from commerce.store_tax_profile where store_id = ${storeId}::uuid
  `);
  if (!row) return null;
  return { vatNumber: row.vat_number === null ? null : String(row.vat_number), registered: row.vat_registered === true };
}

/**
 * What a store's legal starter pages are filled from (docs/wave-1-trust.md 2.1): the facts the store holds, read now (never a
 * cached copy of the shipping or return rules), assembled by the pure `assembleLegalFacts()`. A fact the store does not hold is
 * null there and becomes a visible `[[Add: …]]` placeholder in the text, never an invented sentence.
 */
export async function legalFacts(store: Store): Promise<LegalFacts> {
  const [rates, carriers, returnSettings, tax, chat] = await Promise.all([
    db().execute<Row>(sql`
      select market_code, currency, amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${store.id}::uuid
    `),
    listCarriers(store.id),
    getReturnSettings(store.id),
    taxFactsOf(store.id),
    chatWidgetFor(store.id),
  ]);
  const main = store.markets[0];
  const modules = [store.bookingsOn ? "bookings" : null, store.deliveriesOn ? "deliveries" : null, store.workOn ? "work" : null].filter((m): m is string => m !== null);
  return assembleLegalFacts({
    store: {
      name: store.name,
      legalName: store.details.legalName,
      organisationNumber: store.details.organisationNumber,
      contactEmail: store.details.contactEmail,
      postalAddress: store.details.postalAddress,
      country: store.details.country,
      audience: store.audience,
      visitCounting: store.visitCounting,
      modules,
      tracking: store.tracking,
    },
    tax,
    markets: store.markets.map((m) => ({ code: m.code, currency: m.nativeCurrency })),
    shippingRates: rates.map((row) => ({
      marketCode: String(row.market_code).toUpperCase(),
      currency: String(row.currency),
      rateMinor: Number(row.amount_minor),
      freeAboveMinor: row.free_over_minor == null ? null : Number(row.free_over_minor),
    })),
    // The carriers the store has connected: those whose agreement is complete.
    carrierNames: carriers.filter((c) => c.complete).map((c) => carrierInfo(c.carrier)?.name ?? c.carrier),
    returnSettings,
    chatOn: chat !== null,
    // Where the site's own pages are, in the store's main market: the withdrawal function (D153) and the cookies page.
    links: main ? { withdraw: marketPath(store.slug, main.slug, "/withdraw"), cookies: marketPath(store.slug, main.slug, "/cookies") } : {},
  });
}
