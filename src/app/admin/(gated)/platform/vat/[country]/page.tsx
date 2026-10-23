import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { RateForm } from "@/components/admin/vat/rate-form";
import { RateHistory } from "@/components/admin/vat/rates-table";
import { ShippingRulesCard } from "@/components/admin/vat/shipping-rules-card";
import { PLATFORM_BASE } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";
import { listShippingVatRules, listVatRates, vatCoverage } from "@/server/vat-admin";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { setShippingVatRuleAction, setVatRateAction, verifyVatRateAction } from "../actions";

export const metadata: Metadata = { title: "VAT by country" };

/** One country's VAT (D157): the rate of every category with its full history, the way shipping is taxed there, and a form to set a rate. */
export default async function PlatformVatCountryPage({ params }: PageProps<"/admin/platform/vat/[country]">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platformTools").vat;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const code = (await params).country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) notFound();
  const [coverage, rates, shippingRules] = await Promise.all([vatCoverage(), listVatRates({ country: code }), listShippingVatRules()]);
  const country = coverage.countries.find((c) => c.code === code);
  if (!country) notFound();
  const names = new Map(coverage.categories.map((c) => [c.code, c.nameEn]));
  const countries = coverage.countries.map((c) => ({ code: c.code, name: c.name }));
  const todays = coverage.categories.filter((c) => c.code !== "exempt");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm">
          <Link href={`${PLATFORM_BASE}/vat`} className="underline">
            {w.title}
          </Link>
        </p>
        <PageHeader
          title={<>{country.name}</>}
          description={<>{fillWords(w.countryIntro, { country: country.name })}</>}
        />
        </div>
      <Card title={w.today} className="flex flex-col gap-4" compact>
        <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {todays.map((category) => {
            const cell = country.cells[category.code];
            return (
              <li key={category.code} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {category.nameEn}
                  {!category.active && <span className="text-muted">{w.off}</span>}
                </span>
                <span className={`tabular-nums ${cell?.fallback ? "text-muted" : ""}`}>
                  {cell ? cell.text : "-"}
                  {cell && !cell.fallback && !cell.verified && <span className="text-muted">{w.unverifiedNote}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <RateHistory rows={rates} categoryName={(c) => names.get(c) ?? c} verify={(c, k, from) => verifyVatRateAction.bind(null, c, k, from)} words={w} locale={locale} />
      <RateForm categories={todays} countries={countries} country={code} action={setVatRateAction} words={w} />
      <ShippingRulesCard rules={shippingRules} countries={countries} country={code} action={setShippingVatRuleAction} words={w} locale={locale} />
    </div>
  );
}
