import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { PayoutDetailView } from "@/components/admin/analytics/payouts-view";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { payoutReportOf } from "@/lib/payouts";
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
  const words = adminText(ctx.lang, "finance");
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        back={{ href: `${ctx.base}/analytics/payouts`, label: words.pages.payoutsTitle }}
        title={fillWords(words.pages.payoutTitle, { date: detail.payout.arrivalOn ?? detail.payout.reference })}
        meta={[words.payouts.status[detail.payout.status], ...(detail.payout.testMode ? [words.pages.test] : [])]}
      />
      <PayoutDetailView base={ctx.base} locale={ctx.locale} detail={detail} row={row} words={words} />
    </div>
  );
}
