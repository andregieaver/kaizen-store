import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { resolveAfterSaleShop } from "@/server/shop";
import { stockConfirmWaiting } from "@/server/stock-requests";

import { confirmStockAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/stock/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Confirming a back-in-stock request from its email's link (D298, `docs/wave-5-marketing.md` 6.4). A button, not the link itself, confirms it,
 * so a mail scanner that opens links asks for nothing.
 */
export default function ConfirmStockPage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <ConfirmStock params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ConfirmStock({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const m = t(shop.market.lang);
  const query = await searchParams;
  const product = query.done ? null : await stockConfirmWaiting(shop.store.id, token, shop.market.locale);
  return (
    <>
      <h1 className="text-3xl font-heading tracking-tight">{m.stockNotice.confirmHeading}</h1>
      {query.done ? (
        <p role="status">{m.stockNotice.confirmed}</p>
      ) : !product ? (
        <p role="alert">{m.stockNotice.expired}</p>
      ) : (
        <form action={confirmStockAction.bind(null, shop.store.slug, shop.market.slug, token)} className="flex flex-col gap-4">
          <p>{m.stockNotice.pageIntro(product)}</p>
          <button type="submit" className="min-h-11 self-start button-primary px-5 font-medium">
            {m.stockNotice.confirmButton}
          </button>
        </form>
      )}
    </>
  );
}
