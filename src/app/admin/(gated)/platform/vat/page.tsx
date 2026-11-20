import type { Metadata } from "next";
import { connection } from "next/server";

import { CategoriesCard } from "@/components/admin/vat/categories-card";
import { CoverageCard } from "@/components/admin/vat/coverage-card";
import { RateForm } from "@/components/admin/vat/rate-form";
import { UnverifiedCard } from "@/components/admin/vat/rates-table";
import { VatPhoneList } from "@/components/admin/vat/phone-list";
import { ShippingRulesCard } from "@/components/admin/vat/shipping-rules-card";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { requirePlatformReader } from "@/server/auth";
import { listShippingVatRules, unverifiedRates, vatCoverage } from "@/server/vat-admin";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_TOOLS_WORDS } from "@/lib/admin-words/platform-tools";

import { addVatCategoryAction, setShippingVatRuleAction, setVatCategoryActiveAction, setVatRateAction, verifyVatRateAction } from "./actions";

export const metadata: Metadata = { title: "VAT rates" };

/**
 * VAT for every store (D157, `docs/wave-1a-tax.md` 2.3): the categories owners choose from, each country's rate per category with its
 * history, source and who verified it, the rates nobody has verified yet, and how shipping is taxed. A rate is never edited in place: a change
 * ends one period and begins another, applies to new carts and orders only, and is written to the audit log.
 */
export default async function PlatformVatPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = PLATFORM_TOOLS_WORDS[lang].vat;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const [coverage, unverified, shippingRules] = await Promise.all([vatCoverage(), unverifiedRates(), listShippingVatRules()]);
  const names = new Map(coverage.categories.map((c) => [c.code, c.nameEn]));
  const countries = coverage.countries.map((c) => ({ code: c.code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="sm:hidden">{w.phone.lead}</span>
            <span className="max-sm:hidden">{w.intro}</span>
          </>
        }
      />
      {/* Round 62 (D823): on a phone what to verify and each country as a row; the tables, the form, the categories and shipping one row away. */}
      <VatPhoneList countries={coverage.countries} unverified={unverified} words={w} locale={locale} />
      <div className="contents max-sm:hidden">
        <UnverifiedCard rows={unverified} categoryName={(code) => names.get(code) ?? code} verify={(c, k, from) => verifyVatRateAction.bind(null, c, k, from)} words={w} locale={locale} />
        <CoverageCard categories={coverage.categories} countries={coverage.countries} words={w} />
      </div>
      <PhoneRows>
        <PhoneRow flat title={w.rateForm.title} change={w.phone.open} done={w.phone.close}>
          <RateForm categories={coverage.categories.filter((c) => c.code !== "exempt")} countries={countries} action={setVatRateAction} words={w} />
        </PhoneRow>
        <PhoneRow flat title={w.categories.title} change={w.phone.open} done={w.phone.close}>
          <CategoriesCard categories={coverage.categories} addAction={addVatCategoryAction} activeAction={(code, active) => setVatCategoryActiveAction.bind(null, code, active)} words={w} />
        </PhoneRow>
        <PhoneRow flat last title={w.shipping.title} change={w.phone.open} done={w.phone.close}>
          <ShippingRulesCard rules={shippingRules} countries={countries} action={setShippingVatRuleAction} words={w} locale={locale} />
        </PhoneRow>
      </PhoneRows>
    </div>
  );
}
