import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ExchangeWishForm } from "@/components/exchange/exchange-wish-form";
import { ReturnStatusView } from "@/components/withdraw/return-status-view";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { CARRIERS } from "@/lib/shipping-carriers";
import { wishOfferedFor } from "@/server/exchanges";
import { getShopperReturn } from "@/server/returns";
import { resolveAfterSaleShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/returns/[token]">;

/** The status of a return: the address is a secret, so it is for no search engine. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A return's status (D153, `docs/returns.md`), at the secret address in its emails. It shows where the return stands,
 * what to do next and what came of it, and shows no email or address of the shopper, only the order number. With D239 it also shows the return label
 * (a booked one printed through `/returns/{token}/label`), the exchange's state, and the one thing a shopper may send from here: an exchange wish.
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
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const ret = await getShopperReturn(store.id, token);
  if (!ret) notFound();
  const m = t(market.lang);
  // The wish (D239 2.1) is offered only while the return can be exchanged and nothing was asked or proposed yet; asking is the shopper's own, after the withdrawal.
  const wish = ret.exchange || ret.exchangeWishAt ? false : await wishOfferedFor(store.id, token);
  const carrier = ret.label.carrierId ? CARRIERS.find((c) => c.id === ret.label.carrierId) : undefined;
  return (
    <ReturnStatusView
      m={m.returns}
      ret={ret}
      locale={market.locale}
      extras={{
        words: { exchange: m.exchange, returnLabel: m.returnLabel, exchangeWish: m.exchangeWish },
        labelRoute: ret.label.source === "carrier" ? marketPath(store.slug, market.slug, `/returns/${token}/label`) : null,
        carrierName: carrier?.name ?? null,
        wishForm: wish ? <ExchangeWishForm store={store.slug} market={market.slug} token={token} lang={market.lang} /> : null,
      }}
    />
  );
}
