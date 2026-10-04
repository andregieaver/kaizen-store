import type { Metadata } from "next";
import { Suspense } from "react";

import { RequestsSkeleton } from "@/components/admin/privacy/skeletons";
import { RequestsView, requestsFilter } from "@/components/admin/privacy/requests-view";
import { memberCan, requirePermission } from "@/server/permissions";
import { listRequests } from "@/server/privacy-requests";

export const metadata: Metadata = { title: "Privacy requests" };

type Props = PageProps<"/admin/[store]/privacy">;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The log of privacy requests (wave 1, 1g, D162): what people have asked of the store about their data, with the one-month clock. Reading
 * is for those who may read customers; logging and answering are for those who may change them.
 */
export default async function PrivacyRequestsPage({ params, searchParams }: Props) {
  const member = await requirePermission((await params).store, "customers:read");
  return (
    <Suspense fallback={<RequestsSkeleton />}>
      <List storeSlug={member.store.slug} searchParams={searchParams} />
    </Suspense>
  );
}

async function List({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "customers:read");
  const filter = requestsFilter(first((await searchParams).status));
  const requests = await listRequests(member.store.id, { status: "all", limit: 200 });
  return <RequestsView base={`/admin/${member.store.slug}`} requests={requests} filter={filter} canWrite={memberCan(member, "customers:write")} timeZone={member.store.timeZone} />;
}
