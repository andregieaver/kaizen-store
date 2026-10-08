import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DraftsListView } from "@/components/admin/drafts/drafts-list-view";
import { isDraftStatus } from "@/lib/draft-status";
import { listDrafts } from "@/server/draft-orders";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Draft orders" };

type Props = PageProps<"/admin/[store]/orders/drafts">;

/**
 * Draft orders (wave 3, D173, `docs/wave-3-orders.md` 2.4): orders staff make for a customer, who pays through a link, or that staff record as paid outside Kaizen. `orders:read` to
 * look, `orders:write` to make and change. The list is paged by a cursor, 50 a page.
 */
export default async function DraftsPage({ params, searchParams }: Props) {
  const member = await requirePermission((await params).store, "orders:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/orders`} className="text-sm text-muted underline underline-offset-2">
          Orders
        </Link>
        <h1 className="text-2xl font-semibold">Draft orders</h1>
        <p className="max-w-3xl text-sm text-muted">
          A draft is an order you make for a customer: products or custom items, your own prices, a discount and shipping. Send it and the customer gets a link to pay on Stripe&apos;s page, or record that they paid you outside Kaizen.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-background" />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "orders:read");
  const { store } = member;
  const query = await searchParams;
  const rawStatus = Array.isArray(query.status) ? query.status[0] : query.status;
  const status = isDraftStatus(rawStatus) ? rawStatus : null;
  const rawAfter = Array.isArray(query.after) ? query.after[0] : query.after;
  const page = await listDrafts(store.id, { status, after: rawAfter ?? null });
  return (
    <DraftsListView
      slug={store.slug}
      rows={page.rows}
      status={status}
      nextCursor={page.nextCursor}
      hasCursor={Boolean(rawAfter)}
      openCount={page.openCount}
      canWrite={memberCan(member, "orders:write")}
      locale={store.markets[0]?.locale ?? "en"}
      timeZone={store.timeZone}
    />
  );
}
