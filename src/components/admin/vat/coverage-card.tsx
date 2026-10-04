import Link from "next/link";

import { PLATFORM_BASE } from "@/lib/platform-nav";
import type { VatCategoryRow } from "@/lib/vat";
import type { CoverageCountry } from "@/server/vat-admin";

import { card } from "./styles";

/**
 * Category by country (D157): each cell is the rate, or *the standard rate applies* where no reduced rate is known, never a silent
 * different number. A dot marks a rate nobody has verified. Countries any open store sells to come first.
 */
export function CoverageCard({ categories, countries }: { categories: VatCategoryRow[]; countries: CoverageCountry[] }) {
  const shown = categories.filter((c) => c.code !== "exempt");
  return (
    <section aria-labelledby="coverage" className={card}>
      <div>
        <h2 id="coverage" className="font-medium">
          Coverage
        </h2>
        <p className="text-sm text-muted">
          Where a category has no rate for a country, the standard rate is charged: the cell says <em>standard</em>. A dot (<span aria-hidden="true">•</span>
          <span className="sr-only">marked unverified</span>) marks a rate that nobody has verified yet. Countries with an open store come first.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <caption className="sr-only">VAT rates by country and category</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Country</th>
              {shown.map((category) => (
                <th key={category.code} scope="col" className="py-2 pr-3 text-right font-medium">
                  {category.nameEn}
                  {!category.active && <span className="block text-xs font-normal">Off</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {countries.map((country) => (
              <tr key={country.code}>
                <th scope="row" className="py-2 pr-3 font-normal">
                  <Link href={`${PLATFORM_BASE}/vat/${country.code}`} className="underline">
                    {country.name}
                  </Link>
                  {country.inUse && <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted">In use</span>}
                </th>
                {shown.map((category) => {
                  const cell = country.cells[category.code];
                  if (!cell) return <td key={category.code} className="py-2 pr-3 text-right text-muted">-</td>;
                  const label = cell.fallback ? "standard" : `${Math.round(cell.rate * 1000) / 10} %`;
                  return (
                    <td key={category.code} className={`py-2 pr-3 text-right tabular-nums ${cell.fallback ? "text-muted" : ""}`}>
                      {label}
                      {!cell.fallback && !cell.verified && (
                        <>
                          <span aria-hidden="true"> •</span>
                          <span className="sr-only"> (unverified)</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
