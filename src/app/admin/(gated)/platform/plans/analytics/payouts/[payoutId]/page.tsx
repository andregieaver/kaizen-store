import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { payoutFlagged } from "@/lib/payouts";
import { requirePlatformAdmin } from "@/server/auth";
import { platformPayoutDetail } from "@/server/platform-payouts";

export const metadata: Metadata = { title: "Payout" };

/**
 * One of Kaizena Flow's own Stripe payouts (D509, the platform's twin of a store's payout, D290): what it carried, line by line, the sale
 * and the store each line was for, Stripe's fees and whether it adds up. Stored rows only, no Stripe call.
 */
export default async function PlatformPayoutPage({ params }: PageProps<"/admin/platform/plans/analytics/payouts/[payoutId]">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const lang = adminLangOf(admin.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const detail = await platformPayoutDetail((await params).payoutId);
  if (!detail) notFound();
  const w = adminText(lang, "console").planAnalytics.payouts;
  const fw = adminText(lang, "finance").payouts;
  const { payout, reconciliation: r, lines } = detail;
  const money = (minor: number, currency = payout.currency) => formatMoney(minor, currency, locale);
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "UTC" });
  const stateText = payout.status !== "paid" ? null : payout.state === "untied" ? w.untied : fw.states[payout.state];
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        back={{ href: "/admin/platform/plans/analytics", label: w.back }}
        title={fillWords(w.pageTitle, { date: day(payout.arrivalOn) })}
        meta={[fw.status[payout.status], payout.stripePayoutId, ...(payout.mode === "test" ? [w.test] : [])]}
      />
      <StatGrid>
        <Stat label={w.amount} value={money(payout.amountMinor)} />
        <Stat label={w.fees} value={money(payout.feeMinor)} />
        <Stat label={w.sales} value={payout.sales} />
        {stateText && <Stat label={w.reconciliation} value={stateText} sub={r.state === "difference" ? fillWords(w.difference, { amount: money(r.differenceMinor) }) : undefined} />}
      </StatGrid>
      <Card title={w.linesTitle} description={w.linesDescription}>
        {lines.length === 0 ? (
          <p className="text-sm text-muted">{w.linesNone}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-3 py-2 text-left font-normal">
                    {w.line}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">
                    {w.sale}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">
                    {w.store}
                  </th>
                  <th scope="col" className={`${cell} font-normal`}>
                    {w.gross}
                  </th>
                  <th scope="col" className={`${cell} font-normal`}>
                    {w.fee}
                  </th>
                  <th scope="col" className={`${cell} font-normal`}>
                    {w.net}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l) => {
                  const forSale = l.kind === "charge" || l.kind === "refund" || l.kind === "dispute";
                  const kind = l.sale?.kind;
                  return (
                    <tr key={l.id}>
                      <th scope="row" className="px-3 py-2 text-left font-normal whitespace-nowrap">
                        {fw.kinds[l.kind]}
                      </th>
                      <td className={`px-3 py-2 ${forSale && !l.sale && payoutFlagged(payout.state) ? "text-danger-text" : ""}`}>
                        {l.sale
                          ? [kind === "plan" || kind === "theme" || kind === "domain" || kind === "other" ? w.saleKinds[kind] : null, l.sale.number, l.sale.paidOn ? day(l.sale.paidOn) : null]
                              .filter(Boolean)
                              .join(" · ")
                          : forSale
                            ? w.noSale
                            : ""}
                      </td>
                      <td className="px-3 py-2">
                        {l.sale?.storeSlug ? (
                          <Link href={`/admin/platform/stores/${l.sale.storeSlug}`} className="underline underline-offset-2 hover:text-ink">
                            {l.sale.storeName ?? l.sale.storeSlug}
                          </Link>
                        ) : null}
                      </td>
                      <td className={cell}>{money(l.amountMinor, l.currency)}</td>
                      <td className={cell}>{l.feeMinor === 0 ? "" : money(l.feeMinor, l.currency)}</td>
                      <td className={cell}>{money(l.netMinor, l.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
