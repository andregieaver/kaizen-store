import type { Metadata } from "next";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DraftsListView } from "@/components/admin/drafts/drafts-list-view";
import { isDraftStatus } from "@/lib/draft-status";
import { listDrafts } from "@/server/draft-orders";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

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
  const w = adminText(adminLangOf(member.account.adminLocale), "drafts").pages;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/orders`, label: w.orders }} title={w.listTitle} description={w.listDescription} />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-card" />}>
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
  const lang = adminLangOf(member.account.adminLocale);
  const locale = store.markets[0]?.locale ?? "en";
  return (
    <DraftsListView
      slug={store.slug}
      rows={page.rows}
      status={status}
      nextCursor={page.nextCursor}
      hasCursor={Boolean(rawAfter)}
      openCount={page.openCount}
      canWrite={memberCan(member, "orders:write")}
      locale={locale}
      timeZone={store.timeZone}
      words={adminText(lang, "drafts")}
      dateLocale={lang === "en" ? locale : ADMIN_LANG_FACTS[lang].locale}
    />
  );
}
