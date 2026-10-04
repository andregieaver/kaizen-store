import type { Metadata } from "next";
import { connection } from "next/server";

import { CategoriesCard } from "@/components/admin/vat/categories-card";
import { CoverageCard } from "@/components/admin/vat/coverage-card";
import { RateForm } from "@/components/admin/vat/rate-form";
import { UnverifiedCard } from "@/components/admin/vat/rates-table";
import { ShippingRulesCard } from "@/components/admin/vat/shipping-rules-card";
import { requirePlatformAdmin } from "@/server/auth";
import { listShippingVatRules, unverifiedRates, vatCoverage } from "@/server/vat-admin";

import { addVatCategoryAction, setShippingVatRuleAction, setVatCategoryActiveAction, setVatRateAction, verifyVatRateAction } from "./actions";

export const metadata: Metadata = { title: "VAT" };

/**
 * VAT for every store (D157, `docs/wave-1a-tax.md` 2.3): the categories owners choose from, each country's rate per category with its
 * history, source and who verified it, the rates nobody has verified yet, and how shipping is taxed. A rate is never edited in place: a change
 * ends one period and begins another, applies to new carts and orders only, and is written to the audit log.
 */
export default async function PlatformVatPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [coverage, unverified, shippingRules] = await Promise.all([vatCoverage(), unverifiedRates(), listShippingVatRules()]);
  const names = new Map(coverage.categories.map((c) => [c.code, c.nameEn]));
  const countries = coverage.countries.map((c) => ({ code: c.code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">VAT</h1>
        <p className="max-w-2xl text-sm text-muted">
          The rates every store charges. Prices include VAT, and each sale takes the VAT of the country it goes to. The rates here were read from public sources and start unverified: they
          are still charged, so work through the list with an accountant. This is not tax advice.
        </p>
      </div>
      <UnverifiedCard rows={unverified} categoryName={(code) => names.get(code) ?? code} verify={(c, k, from) => verifyVatRateAction.bind(null, c, k, from)} />
      <CoverageCard categories={coverage.categories} countries={coverage.countries} />
      <RateForm categories={coverage.categories.filter((c) => c.code !== "exempt")} countries={countries} action={setVatRateAction} />
      <CategoriesCard categories={coverage.categories} addAction={addVatCategoryAction} activeAction={(code, active) => setVatCategoryActiveAction.bind(null, code, active)} />
      <ShippingRulesCard rules={shippingRules} countries={countries} action={setShippingVatRuleAction} />
    </div>
  );
}
