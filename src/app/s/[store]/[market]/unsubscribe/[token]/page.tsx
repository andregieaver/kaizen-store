import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { resolveShop } from "@/server/shop";

import { unsubscribeAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/unsubscribe/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Stopping cart reminders from an email's link (D33). A button, not the
 * link itself, does it, so mail scanners that open links unsubscribe no one.
 */
export default function UnsubscribePage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <Unsubscribe params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Unsubscribe({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const m = t(shop.market.lang);
  const query = await searchParams;
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{m.unsubscribeTitle}</h1>
      {query.done ? (
        <p role="status">{m.unsubscribed}</p>
      ) : query.unknown ? (
        <p role="alert">{m.unsubscribeUnknown}</p>
      ) : (
        <form action={unsubscribeAction.bind(null, shop.store.slug, shop.market.slug, token)} className="flex flex-col gap-4">
          <p>{m.unsubscribeIntro}</p>
          <button type="submit" className="min-h-11 self-start rounded-full bg-foreground px-5 font-medium text-background">
            {m.unsubscribeButton}
          </button>
        </form>
      )}
    </>
  );
}
