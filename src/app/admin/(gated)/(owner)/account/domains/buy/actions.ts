"use server";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import type { FormState } from "@/components/admin/action-form";
import type { CheckoutBuyer, CheckoutQuote } from "@/components/admin/domain-types";
import { db } from "@/db/client";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { currencyForCountry, vatFor, VAT_PROBLEM_TEXT, withVat } from "@/lib/domain-buyer";
import { requireAccount } from "@/server/auth";
import { accountHolder } from "@/server/domain-holder";
import { domainPricingRows } from "@/server/domain-prices";
import { chargeDomainPurchases, quoteDomain, startDomainPurchase } from "@/server/domain-purchases";
import { storeRegistrations } from "@/server/domain-registrations";
import { searchDomains, type SearchAnswer } from "@/server/domain-search";

/** Searching names to buy without a store (D317): the account's own hourly searches, prices in NOK until the buyer says where they are. */
export async function checkoutSearchAction(query: string): Promise<SearchAnswer> {
  const account = await requireAccount();
  const priced = (await domainPricingRows()).map((p) => p.currency);
  const owned = (await storeRegistrations(accountHolder(account.id))).map((r) => r.apex);
  return searchDomains(String(query ?? "").slice(0, 200), { asker: { visitor: `account:${account.id}` }, currency: currencyForCountry("NO", priced), owned });
}

/** The price for this buyer: what the invoice says before VAT, and with the VAT it will carry (never a VAT worked out in the browser). */
export async function checkoutQuoteAction(domain: string, buyer: CheckoutBuyer): Promise<CheckoutQuote> {
  const account = await requireAccount();
  const vat = vatFor({ kind: buyer.kind === "business" ? "business" : "consumer", country: String(buyer.country ?? ""), vatNumber: buyer.vatNumber });
  if (!vat.ok && vat.problem !== "vat_number_needed") return { ok: false, problems: [VAT_PROBLEM_TEXT[vat.problem]] };
  const q = await quoteDomain(accountHolder(account.id), String(domain), 1, { country: String(buyer.country ?? "") });
  if (!q.ok) return q;
  const vatKind = vat.ok ? vat.vatKind : "reverse_charge";
  const ratePercent = vat.ok ? vat.ratePercent : 0;
  const totalMinor = withVat(q.quote.amountMinor, ratePercent);
  return { ok: true, domain: q.quote.domain, currency: q.quote.currency, amountMinor: q.quote.amountMinor, vatKind, ratePercent, vatMinor: totalMinor - q.quote.amountMinor, totalMinor };
}

/** Starts the purchase, makes its invoice at once and sends the buyer to Stripe's page to pay it. */
export async function checkoutBuyAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const words = adminText(lang, "domains");
  const value = (key: string) => String(form.get(key) ?? "");
  const kind = value("buyer") === "business" ? "business" : "consumer";
  const result = await startDomainPurchase(account, accountHolder(account.id), {
    domain: value("domain"),
    years: 1,
    agreed: value("agreed"),
    connect: false,
    registrant: {
      kind: value("kind") === "company" ? "company" : "person",
      firstName: value("firstName"),
      lastName: value("lastName"),
      companyName: value("companyName"),
      orgNumber: value("orgNumber"),
      email: value("email"),
      phone: value("phone"),
      address1: value("address1"),
      address2: value("address2"),
      city: value("city"),
      state: value("state"),
      postalCode: value("postalCode"),
      country: value("country"),
    },
    buyer: { kind, country: value("buyerCountry"), vatNumber: value("vatNumber") || null },
    consent: { given: form.get("consent") === "on", lang: lang === "nb" ? "nb" : "en" },
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  await chargeDomainPurchases({ purchaseId: result.purchase.id, limit: 1 });
  const [row] = await db().execute<Record<string, unknown>>(sql`select invoice_url from commerce.domain_purchases where id = ${result.purchase.id}::uuid`);
  if (row?.invoice_url) redirect(String(row.invoice_url));
  return { status: "ok", messages: [words.checkout.paidOutside] };
}
