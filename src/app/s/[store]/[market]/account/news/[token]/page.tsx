import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { confirmationWaiting } from "@/server/marketing-subscribers";
import { resolveAfterSaleShop } from "@/server/shop";

import { confirmNewsAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/news/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Confirming a marketing sign-up from its email's link (D295, `docs/wave-5-marketing.md` 3.2). A button, not the link itself, subscribes, so a
 * mail scanner that opens links subscribes no one.
 */
export default function ConfirmNewsPage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <ConfirmNews params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ConfirmNews({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const m = t(shop.market.lang);
  const query = await searchParams;
  const waiting = query.done ? false : await confirmationWaiting(shop.store.id, token);
  return (
    <>
      <h1 className="text-3xl font-heading tracking-tight">{m.news.heading}</h1>
      {query.done ? (
        <p role="status">{m.news.confirmed}</p>
      ) : !waiting ? (
        <p role="alert">{m.news.expired}</p>
      ) : (
        <form action={confirmNewsAction.bind(null, shop.store.slug, shop.market.slug, token)} className="flex flex-col gap-4">
          <p>{m.news.pageIntro}</p>
          <button type="submit" className="min-h-11 self-start button-primary px-5 font-medium">
            {m.news.confirmButton}
          </button>
        </form>
      )}
    </>
  );
}
