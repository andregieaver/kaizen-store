import type { Metadata } from "next";
import { Suspense } from "react";

import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { ReturnsQueueView } from "@/components/admin/returns/queue-view";
import { QueueSkeleton } from "@/components/admin/returns/skeletons";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { exchangeFilterOf, pageNumber } from "@/lib/return-admin";
import { returnQueueFilter } from "@/lib/return-input";
import { requirePermission } from "@/server/permissions";
import { listReturns, returnCounts } from "@/server/returns";


export const metadata: Metadata = { title: "Returns" };

type Props = PageProps<"/admin/[store]/returns">;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The returns queue (D153): withdrawals and return requests, oldest first, with what is past its refund deadline, what waits
 * for an answer and what acknowledgement was not sent. Every member of the store can work it.
 */
export default async function ReturnsPage({ params, searchParams }: Props) {
  const gated = await requirePermission((await params).store, "orders:read");
  // While the online shop is off (D178 step 5), what was sold stays reachable as long as an order can still be withdrawn from or returned.
  const shopOff = await requireShopOrAfterSale(gated);
  if (shopOff) return shopOff;
  const { store } = gated;
  return (
    <Suspense fallback={<QueueSkeleton label={adminText(adminLangOf(gated.account.adminLocale), "returns").queue.loading} />}>
      <Queue storeSlug={store.slug} searchParams={searchParams} />
    </Suspense>
  );
}

async function Queue({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const { account, store } = await requirePermission(storeSlug, "orders:read");
  const lang = adminLangOf(account.adminLocale);
  const query = await searchParams;
  const filter = returnQueueFilter.parse({ status: first(query.status), kind: first(query.kind), q: first(query.q), overdue: first(query.overdue) });
  const exchange = exchangeFilterOf(query.exchange);
  const [queue, counts] = await Promise.all([listReturns(store.id, filter, { page: pageNumber(query.page), exchange }), returnCounts(store.id)]);
  return <ReturnsQueueView base={`/admin/${store.slug}/returns`} filter={filter} exchange={exchange} queue={queue} counts={counts} timeZone={store.timeZone} locale={ADMIN_LANG_FACTS[lang].locale} words={adminText(lang, "returns")} />;
}
