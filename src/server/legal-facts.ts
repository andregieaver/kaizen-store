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
 * The store's tax facts for the legal texts: its VAT number and whether it is registered for VAT. Unit 1a adds the store's tax
 * profile (`commerce.store_tax_profile`) in the other lane; this lane does not depend on its schema, so the one place that reads it
 * is this function, which answers null until the lead replaces its body at the merge with that read (one query). Until then
 * the imprint and the terms show `[[Add: VAT number]]`, unless the store is known to be unregistered.
 */
export async function taxFactsOf(storeId: string): Promise<{ vatNumber: string | null; registered: boolean | null } | null> {
  void storeId;
  return null;
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
