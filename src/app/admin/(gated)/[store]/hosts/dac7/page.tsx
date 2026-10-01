import type { Metadata } from "next";
import Link from "next/link";

import { decimalAmount } from "@/lib/dac7";
import { requireMember } from "@/server/auth";
import { dac7Report } from "@/server/dac7";

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
  const { store, role } = await requireMember((await params).store);
  const current = thisYear();
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= current - 3 && asked <= current ? asked : current - 1;
  const report = await dac7Report(store.id, year, store.timeZone);
  const base = `/admin/${store.slug}/hosts`;
  const missingDetails = report.sellers.filter((s) => !s.details);
  const missingAddresses = report.properties.filter((p) => !p.address);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={base} className="text-sm underline">
          Hosts
        </Link>
        <h1 className="text-2xl font-semibold">Tax report (DAC7)</h1>
        <p className="text-sm text-muted">
          As a marketplace, the store reports its hosts and what they were paid to the tax authority of the country it is
          based in, once a year, by 31 January for the year before (in Norway, to Skatteetaten). Here is what Kaizen has
          gathered for {year}: check it, then file it in the tax authority&apos;s service. Amounts are what guests paid,
          refunds taken off, by quarter of payment; the commission is the store&apos;s. The host&apos;s net is
          what they earned after the commission and Kaizen&apos;s fee (before Stripe&apos;s own fees); it is for your
          records, and not part of what the report asks for.
        </p>
      </div>

      <nav aria-label="Year" className="flex flex-wrap gap-2 text-sm">
        {[current, current - 1, current - 2].map((y) => (
          <Link
            key={y}
            href={`${base}/dac7?year=${y}`}
            aria-current={y === year ? "page" : undefined}
            className={`min-h-10 rounded-md border border-border px-3 py-2 ${y === year ? "bg-surface font-medium" : ""}`}
          >
            {y}
            {y === current && " (so far)"}
          </Link>
        ))}
      </nav>

      {(missingDetails.length > 0 || missingAddresses.length > 0) && (
        <div role="alert" className="rounded-lg border border-red-700/40 p-4 text-sm text-red-700 dark:text-red-400">
          {missingDetails.length > 0 && <p>Tax details missing for: {missingDetails.map((s) => s.name).join(", ")}.</p>}
          {missingAddresses.length > 0 && <p>Address missing for: {missingAddresses.map((p) => p.name).join(", ")}.</p>}
          <p>Hosts give these in their area; remind them before you file.</p>
        </div>
      )}

      <section aria-labelledby="sellers-heading" className="flex flex-col gap-2">
        <h2 id="sellers-heading" className="font-medium">
          Hosts paid in {year}
        </h2>
        {report.sellers.length === 0 ? (
          <p className="text-sm text-muted">No host was paid in {year}: there is nothing to report.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="p-2 font-normal">Host</th>
                  <th className="p-2 font-normal">Tax details</th>
                  <th className="p-2 text-right font-normal">Paid</th>
                  <th className="p-2 text-right font-normal">Commission</th>
                  <th className="p-2 text-right font-normal">Host&apos;s net</th>
                  <th className="p-2 text-right font-normal">Bookings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.sellers.map((s) => (
                  <tr key={`${s.hostId}:${s.currency}`}>
                    <td className="p-2">{s.name}</td>
                    <td className="p-2">{s.details ? `${s.details.legalName} (${s.details.tinCountry})` : "Missing"}</td>
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
          <h2 id="properties-heading" className="font-medium">
            Homes rented out
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {report.properties.map((p) => (
              <li key={`${p.resourceId}:${p.currency}`} className="flex flex-wrap justify-between gap-2 p-3">
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-muted">{p.address || "No address yet"}</span>
                </span>
                <span className="text-right tabular-nums">
                  {sum(p.activities)} bookings · {p.nights} nights
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.sellers.length > 0 &&
        (role === "owner" ? (
          <section aria-labelledby="download-heading" className="flex flex-col gap-2 text-sm">
            <h2 id="download-heading" className="font-medium">
              Download
            </h2>
            <p className="text-muted">Spreadsheets with every field the report asks for, per quarter.</p>
            <div className="flex flex-wrap gap-3">
              <a href={`${base}/dac7/${year}/sellers.csv`} className="min-h-10 rounded-md border border-border px-3 py-2" download>
                Hosts ({year})
              </a>
              {report.properties.length > 0 && (
                <a href={`${base}/dac7/${year}/properties.csv`} className="min-h-10 rounded-md border border-border px-3 py-2" download>
                  Homes ({year})
                </a>
              )}
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted">The store&apos;s owners download the report, as it holds hosts&apos; tax numbers.</p>
        ))}
    </div>
  );
}
