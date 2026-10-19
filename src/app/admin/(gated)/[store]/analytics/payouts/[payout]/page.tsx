import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { PayoutDetailView } from "@/components/admin/analytics/payouts-view";
import { PageHeader } from "@/components/admin/ui";
import { payoutReportOf, PAYOUT_STATUS_WORDS } from "@/lib/payouts";
import { analyticsContext } from "@/server/analytics-context";
import { toMainOne } from "@/server/analytics-sql";
import { payoutDetail } from "@/server/payouts-report";

export const metadata: Metadata = { title: "Payout" };

/** One Stripe payout (wave 4 unit C, D290): what it settles, line by line, with the order each is for, and whether it adds up. */
export default async function PayoutPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/payouts/[payout]">) {
  const { store: slug, payout } = await params;
  const ctx = await analyticsContext(slug, await searchParams);
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  if (!z.uuid().safeParse(payout).success) notFound();
  const detail = await payoutDetail(ctx.store, payout);
  if (!detail) notFound();
  const [row] = payoutReportOf([detail.payout], (currency, minor) => toMainOne(ctx.store, currency, minor)).payouts;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        back={{ href: `${ctx.base}/analytics/payouts`, label: "Payouts" }}
        title={`Payout ${detail.payout.arrivalOn ?? detail.payout.reference}`}
        meta={[PAYOUT_STATUS_WORDS[detail.payout.status], ...(detail.payout.testMode ? ["Test"] : [])]}
      />
      <PayoutDetailView base={ctx.base} locale={ctx.store.markets[0]?.locale ?? "en"} detail={detail} row={row} />
    </div>
  );
}
