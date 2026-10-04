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

import { setShippingVatRuleAction, setVatRateAction, verifyVatRateAction } from "../actions";

export const metadata: Metadata = { title: "VAT by country" };

/** One country's VAT (D157): the rate of every category with its full history, the way shipping is taxed there, and a form to set a rate. */
export default async function PlatformVatCountryPage({ params }: PageProps<"/admin/platform/vat/[country]">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
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
            VAT
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{country.name}</h1>
        <p className="max-w-2xl text-sm text-muted">The VAT rates stores charge on sales to {country.name}, and how shipping is taxed there.</p>
      </div>
      <section aria-labelledby="now" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
        <h2 id="now" className="font-medium">
          Today
        </h2>
        <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {todays.map((category) => {
            const cell = country.cells[category.code];
            return (
              <li key={category.code} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {category.nameEn}
                  {!category.active && <span className="text-muted"> (off)</span>}
                </span>
                <span className={`tabular-nums ${cell?.fallback ? "text-muted" : ""}`}>
                  {cell ? cell.text : "-"}
                  {cell && !cell.fallback && !cell.verified && <span className="text-muted"> (unverified)</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <RateHistory rows={rates} categoryName={(c) => names.get(c) ?? c} verify={(c, k, from) => verifyVatRateAction.bind(null, c, k, from)} />
      <RateForm categories={todays} countries={countries} country={code} action={setVatRateAction} />
      <ShippingRulesCard rules={shippingRules} countries={countries} country={code} action={setShippingVatRuleAction} />
    </div>
  );
}
