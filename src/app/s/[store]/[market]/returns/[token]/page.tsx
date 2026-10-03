import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ReturnStatusView } from "@/components/withdraw/return-status-view";
import { t } from "@/lib/i18n";
import { getShopperReturn } from "@/server/returns";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/returns/[token]">;

/** The status of a return: the address is a secret, so it is for no search engine. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A return's status (D153, `docs/returns.md`), at the secret address in its emails. It only shows: where the return stands,
 * what to do next and what came of it. It changes nothing and shows no email or address of the shopper, only the order number.
 */
export default function ReturnStatusPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <ReturnStatus params={params} />
      </Suspense>
    </div>
  );
}

async function ReturnStatus({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const ret = await getShopperReturn(store.id, token);
  if (!ret) notFound();
  return <ReturnStatusView m={t(market.lang).returns} ret={ret} locale={market.locale} />;
}
