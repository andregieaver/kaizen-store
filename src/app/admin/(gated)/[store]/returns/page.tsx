import type { Metadata } from "next";
import { Suspense } from "react";

import { ReturnsQueueView } from "@/components/admin/returns/queue-view";
import { QueueSkeleton } from "@/components/admin/returns/skeletons";
import { pageNumber } from "@/lib/return-admin";
import { returnQueueFilter } from "@/lib/return-input";
import { requireMember } from "@/server/auth";
import { listReturns, returnCounts } from "@/server/returns";


export const metadata: Metadata = { title: "Returns" };

type Props = PageProps<"/admin/[store]/returns">;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The returns queue (D153): withdrawals and return requests, oldest first, with what is past its refund deadline, what waits
 * for an answer and what acknowledgement was not sent. Every member of the store can work it.
 */
export default async function ReturnsPage({ params, searchParams }: Props) {
  const { store } = await requireMember((await params).store);
  return (
    <Suspense fallback={<QueueSkeleton />}>
      <Queue storeSlug={store.slug} searchParams={searchParams} />
    </Suspense>
  );
}

async function Queue({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const { store } = await requireMember(storeSlug);
  const query = await searchParams;
  const filter = returnQueueFilter.parse({ status: first(query.status), kind: first(query.kind), q: first(query.q), overdue: first(query.overdue) });
  const [queue, counts] = await Promise.all([listReturns(store.id, filter, { page: pageNumber(query.page) }), returnCounts(store.id)]);
  return <ReturnsQueueView base={`/admin/${store.slug}/returns`} filter={filter} queue={queue} counts={counts} timeZone={store.timeZone} />;
}
