import Link from "next/link";

import { PLATFORM_BASE } from "@/lib/platform-nav";
import type { VatCategoryRow } from "@/lib/vat";
import type { CoverageCountry } from "@/server/vat-admin";

import { card, VAT_EN, type VatWords } from "./styles";

/**
 * Category by country (D157): each cell is the rate, or *the standard rate applies* where no reduced rate is known, never a silent
 * different number. A dot marks a rate nobody has verified. Countries any open store sells to come first.
 */
export function CoverageCard({ categories, countries, words = VAT_EN }: { categories: VatCategoryRow[]; countries: CoverageCountry[]; words?: VatWords }) {
  const w = words.coverage;
  const [beforeStandard, rest] = w.text.split("{standard}");
  const [betweenDot, afterDot] = (rest ?? "").split("{dot}");
  const shown = categories.filter((c) => c.code !== "exempt");
  return (
    <section aria-labelledby="coverage" className={card}>
      <div>
        <h2 id="coverage" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">
          {beforeStandard}
          <em>{w.standard}</em>
          {betweenDot}
          <span aria-hidden="true">•</span>
          <span className="sr-only">{w.markedUnverified}</span>
          {afterDot}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <caption className="sr-only">{w.caption}</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">{words.country}</th>
              {shown.map((category) => (
                <th key={category.code} scope="col" className="py-2 pr-3 text-right font-medium">
                  {category.nameEn}
                  {!category.active && <span className="block text-xs font-normal">{w.off}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {countries.map((country) => (
              <tr key={country.code}>
                <th scope="row" className="py-2 pr-3 font-normal">
                  <Link href={`${PLATFORM_BASE}/vat/${country.code}`} className="underline">
                    {country.name}
                  </Link>
                  {country.inUse && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-muted">{w.inUse}</span>}
                </th>
                {shown.map((category) => {
                  const cell = country.cells[category.code];
                  if (!cell) return <td key={category.code} className="py-2 pr-3 text-right text-muted">-</td>;
                  const label = cell.fallback ? w.standard : `${Math.round(cell.rate * 1000) / 10} %`;
                  return (
                    <td key={category.code} className={`py-2 pr-3 text-right tabular-nums ${cell.fallback ? "text-muted" : ""}`}>
                      {label}
                      {!cell.fallback && !cell.verified && (
                        <>
                          <span aria-hidden="true"> •</span>
                          <span className="sr-only">{words.unverifiedNote}</span>
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
