import { AdminLink, ButtonLink } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { PlatformToolsMessages } from "@/lib/admin-messages/platform-tools.en";
import type { CoverageCountry, VatRateRow } from "@/server/vat-admin";

type VatWords = PlatformToolsMessages["vat"];

/**
 * Round 62 (D823): VAT rates on a phone. What needs verifying first, as a count with the next country to verify, then each country one
 * row (its rates, their range and how many are verified) opening its own page. From the small breakpoint up the page's tables show instead.
 */
export function VatPhoneList({ countries, unverified, words, locale }: { countries: CoverageCountry[]; unverified: VatRateRow[]; words: VatWords; locale: string }) {
  const w = words.phone;
  const percent = (rate: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate * 100);
  const open = new Map<string, number>();
  for (const row of unverified) open.set(row.country, (open.get(row.country) ?? 0) + 1);
  const sorted = [...countries].sort((a, b) => a.name.localeCompare(b.name, locale));
  const next = sorted.find((country) => open.has(country.code));
  return (
    <div className="flex flex-col gap-3 sm:hidden">
      {unverified.length > 0 && (
        <section className="flex items-center justify-between gap-3 rounded-panel bg-warning-soft px-4 py-3">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body text-ink">{fillWords(w.toVerify, { n: unverified.length })}</span>
            <span className="text-caption text-ink-2">{w.toVerifySub}</span>
          </span>
          {next && (
            <ButtonLink kind="main" size="header" href={`/admin/platform/vat/${next.code}`} className="shrink-0">
              {w.verifyNext}
            </ButtonLink>
          )}
        </section>
      )}
      <nav aria-label={w.countries} className="flex flex-col overflow-hidden rounded-panel bg-card">
        {sorted.map((country) => {
          const rates = Object.values(country.cells).filter((cell) => cell.hasRow).map((cell) => cell.rate);
          const left = open.get(country.code) ?? 0;
          return (
            <AdminLink
              key={country.code}
              href={`/admin/platform/vat/${country.code}`}
              className="flex min-h-14 items-center justify-between gap-3 border-line px-4 py-2 [&:not(:last-child)]:border-b"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body text-ink">
                  {country.code} · {country.name}
                </span>
                <span className="text-caption text-ink-2">
                  {rates.length > 0
                    ? fillWords(w.rates, { n: rates.length, min: percent(Math.min(...rates)), max: percent(Math.max(...rates)) })
                    : w.noRates}
                </span>
              </span>
              <span className="shrink-0 text-caption text-ink-2">{left > 0 ? fillWords(w.left, { n: left }) : w.allVerified}</span>
            </AdminLink>
          );
        })}
      </nav>
    </div>
  );
}
