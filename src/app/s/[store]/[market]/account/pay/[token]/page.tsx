import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PayRouteGuard } from "@/components/pay-route-guard";
import { marketPath } from "@/lib/paths";
import { payPageFor } from "@/server/draft-pay";
import { termsDisplayFor } from "@/server/checkout-terms";
import { listPublishedPages } from "@/server/pages";
import { resolveShop } from "@/server/shop";

import { PayView } from "./pay-view";

type Props = PageProps<"/s/[store]/[market]/account/pay/[token]">;

/** Never indexed, and the address (which holds the token) is not passed on as a referrer. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A draft order's pay link, `/s/{store}/{market}/account/pay/{token}` (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1): from the email a store sent, or a link it shared. The token in the address
 * is the whole access, so there is no sign-in and no cookie: it is long and random, only its hash is kept, and a token of another store, a replaced one and a malformed one are the same not-found page (it
 * streams, so its status line is sent first, as the hosted invoice does). The page is entered by a full page load and the layout draws no tracking, owner code, chat or referral capture on it
 * (`isNoExtrasPath()`). It opens Stripe's own hosted page from its button; it loads no Stripe.js and sets nothing in the browser.
 */
export default function PayLinkPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-2xl animate-pulse rounded-lg bg-surface" />}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: Pick<Props, "params">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const page = await payPageFor({ store, market }, token);
  if (page.state === "not_found") notFound();
  const ready = page.state === "ready";
  const [terms, withdrawalHref] = await Promise.all([ready ? termsDisplayFor(store, market) : null, withdrawalPageHref(store, market.slug)]);
  return (
    <>
      {/* Entered by a full page load, so no script an earlier page added is still here to read the token in the address. */}
      <PayRouteGuard store={store.slug} />
      <PayView page={page} store={store} market={market} token={token} terms={terms} withdrawalHref={withdrawalHref} />
    </>
  );
}

/** The store's published withdrawal-information page (wave 1, 1e), as the shopper's market reaches it; null when the store has none. */
async function withdrawalPageHref(store: { id: string; slug: string; legalPages: Partial<Record<string, string>> }, marketSlug: string): Promise<string | null> {
  const id = store.legalPages.withdrawal_info;
  if (!id) return null;
  const published = (await listPublishedPages(store.id)).find((page) => page.id === id);
  return published ? marketPath(store.slug, marketSlug, `/${published.slug}`) : null;
}
