import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { decimalAmount } from "@/lib/dac7";
import { memberCan, requirePermission } from "@/server/permissions";
import { dac7Report } from "@/server/dac7";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Tax report (DAC7)" };

/** The year as the page is rendered: per request, as the admin is. */
const thisYear = () => new Date().getUTCFullYear();

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * The store's yearly DAC7 report (D71): as platform operator for its hosts,
 * the store reports each host's details and what they were paid, per
 * quarter, and the homes they rented out, by 31 January for the year
 * before. Kaizen prepares it; the store checks it and files it.
 */
export default async function Dac7Page({ params, searchParams }: PageProps<"/admin/[store]/hosts/dac7">) {
  const staffer = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(staffer, "bookings");
  if (off) return off;
  const { store } = staffer;
  const t = adminText(adminLangOf(staffer.account.adminLocale), "bookings");
  const w = t.dac7;
  const current = thisYear();
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= current - 3 && asked <= current ? asked : current - 1;
  const report = await dac7Report(store.id, year, store.timeZone);
  const base = `/admin/${store.slug}/hosts`;
  const missingDetails = report.sellers.filter((s) => !s.details);
  const missingAddresses = report.properties.filter((p) => !p.address);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: t.hosts.title }}
        title={w.title}
        description={fillWords(w.description, { year })}
      />

      <nav aria-label={w.year} className="flex flex-wrap gap-2 text-sm">
        {[current, current - 1, current - 2].map((y) => (
          <Link
            key={y}
            href={`${base}/dac7?year=${y}`}
            aria-current={y === year ? "page" : undefined}
            className={`min-h-10 rounded-pill border border-edge px-3 py-2 ${y === year ? "bg-sunken font-medium" : ""}`}
          >
            {y}
            {y === current && ` ${w.soFar}`}
          </Link>
        ))}
      </nav>

      {(missingDetails.length > 0 || missingAddresses.length > 0) && (
        <div role="alert" className="rounded-lg border border-danger-text/40 p-4 text-sm text-danger-text">
          {missingDetails.length > 0 && <p>{fillWords(w.detailsMissing, { list: missingDetails.map((s) => s.name).join(", ") })}</p>}
          {missingAddresses.length > 0 && <p>{fillWords(w.addressMissing, { list: missingAddresses.map((p) => p.name).join(", ") })}</p>}
          <p>{w.remind}</p>
        </div>
      )}

      <section aria-labelledby="sellers-heading" className="flex flex-col gap-2">
        <h2 id="sellers-heading" className="text-title text-ink">
          {fillWords(w.paidIn, { year })}
        </h2>
        {report.sellers.length === 0 ? (
          <p className="text-sm text-muted">{fillWords(w.nothing, { year })}</p>
        ) : (
          <div className={`overflow-x-auto ${CARD_CLASS}`}>
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-2 font-normal">{w.host}</th>
                  <th className="p-2 font-normal">{w.details}</th>
                  <th className="p-2 text-right font-normal">{w.paid}</th>
                  <th className="p-2 text-right font-normal">{w.commission}</th>
                  <th className="p-2 text-right font-normal">{w.net}</th>
                  <th className="p-2 text-right font-normal">{w.bookings}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.sellers.map((s) => (
                  <tr key={`${s.hostId}:${s.currency}`}>
                    <td className="p-2">{s.name}</td>
                    <td className="p-2">{s.details ? `${s.details.legalName} (${s.details.tinCountry})` : w.missing}</td>
                    <td className="p-2 text-right tabular-nums">
                      {decimalAmount(sum(s.considerationMinor), s.currency)} {s.currency}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {decimalAmount(sum(s.feesMinor), s.currency)} {s.currency}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {decimalAmount(sum(s.netMinor), s.currency)} {s.currency}
                    </td>
                    <td className="p-2 text-right tabular-nums">{sum(s.activities)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report.properties.length > 0 && (
        <section aria-labelledby="properties-heading" className="flex flex-col gap-2">
          <h2 id="properties-heading" className="text-title text-ink">
            {w.homes}
          </h2>
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {report.properties.map((p) => (
              <li key={`${p.resourceId}:${p.currency}`} className="flex flex-wrap justify-between gap-2 p-3">
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-muted">{p.address || w.noAddress}</span>
                </span>
                <span className="text-right tabular-nums">
                  {countWords(sum(p.activities), w.bookingsCount)} · {countWords(p.nights, t.calendar.nights)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.sellers.length > 0 &&
        (memberCan(staffer, "owner") ? (
          <section aria-labelledby="download-heading" className="flex flex-col gap-2 text-sm">
            <h2 id="download-heading" className="text-title text-ink">
              {w.download}
            </h2>
            <p className="text-muted">{w.downloadHint}</p>
            <div className="flex flex-wrap gap-3">
              <a href={`${base}/dac7/${year}/sellers.csv`} className="min-h-10 rounded-pill border border-edge px-3 py-2" download>
                {fillWords(w.hostsFile, { year })}
              </a>
              {report.properties.length > 0 && (
                <a href={`${base}/dac7/${year}/properties.csv`} className="min-h-10 rounded-pill border border-edge px-3 py-2" download>
                  {fillWords(w.homesFile, { year })}
                </a>
              )}
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted">{w.ownersOnly}</p>
        ))}
    </div>
  );
}
