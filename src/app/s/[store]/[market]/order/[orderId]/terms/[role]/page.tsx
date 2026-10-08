import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { StorePageArticle } from "@/components/store-page-article";
import { t } from "@/lib/i18n";
import { isLegalRole } from "@/lib/legal-roles";
import { marketPath } from "@/lib/paths";
import { snapshotForOrder } from "@/server/checkout-terms";
import { resolveAfterSaleShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/order/[orderId]/terms/[role]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * One of the texts an order was placed under (wave 1, 1e, `docs/wave-1-trust.md` 2.4): the store's terms or privacy statement as
 * the shopper was shown them, kept as a snapshot. Read only, and only with the order page's own key (`session_id`): another order's,
 * another store's or an unknown role's is not found. It is a pay route (`/order/…`), so it carries the strict policy and draws no
 * consent manager, owner code or chat.
 */
export default function OrderTermsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <Snapshot params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Snapshot({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, orderId, role } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const key = (await searchParams).session_id;
  if (!z.uuid().safeParse(orderId).success || !isLegalRole(role) || typeof key !== "string") notFound();
  const snapshot = await snapshotForOrder(store.id, orderId, role, key);
  if (!snapshot) notFound();
  const m = t(market.lang);
  const date = snapshot.acceptedAt.toLocaleDateString(market.locale, { dateStyle: "long" });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted">{m.terms.snapshotNote(date)}</p>
      <h1 className="text-3xl font-heading tracking-tight">{snapshot.title}</h1>
      {/* Inert: the snapshot is drawn as a page, with no shop component and nothing bound to today's data. */}
      <StorePageArticle content={snapshot.content} place={{ pageId: null, owner: store.id, market: market.slug }} />
      <Link
        href={`${marketPath(store.slug, market.slug, `/order/${orderId}`)}?session_id=${encodeURIComponent(key)}`}
        className="w-fit underline"
      >
        {m.terms.backToOrder}
      </Link>
    </div>
  );
}
