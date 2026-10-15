import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PayRouteGuard } from "@/components/pay-route-guard";
import { marketPath } from "@/lib/paths";
import { termsDisplayFor } from "@/server/checkout-terms";
import { exchangePageFor } from "@/server/exchange-pay";
import { listPublishedPages } from "@/server/pages";
import { resolveShop } from "@/server/shop";

import { ExchangeView } from "./exchange-view";

type Props = PageProps<"/s/[store]/[market]/account/exchange/[token]">;

/** Never indexed, and the address (which holds the token) is not passed on as a referrer. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The exchange page, `/s/{store}/{market}/account/exchange/{token}` (wave 3, D239, `docs/wave-3-exchanges.md` 2.1): from the email a store sent with its
 * proposal, or a link it shared. Built like the pay links (D173, D174): the token in the address is the whole access, so there is no sign-in and no cookie;
 * only its hash is kept, and a token of another store, an unknown, replaced or malformed one, and one opened under another country's address are the same
 * not-found page (it streams, so its status line is sent first). The page is entered by a full page load and the layout draws no tracking, owner code, chat,
 * consent manager or referral capture on it (`isNoExtrasPath()`). Confirming charges nothing; the pay step's button opens Stripe's own hosted page, so no
 * Stripe.js is loaded here and nothing is set in the browser. It lives under `/account/`, which is reserved, so it can never take a page's address.
 */
export default function ExchangePage({ params }: Props) {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-2xl animate-pulse rounded-lg bg-surface" />}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: Pick<Props, "params">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  // At request time only: the page's state depends on the time (an expired proposal), which cannot be prerendered.
  await connection();
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const page = await exchangePageFor({ store, market }, token);
  if (page.state === "not_found") notFound();
  const proposed = page.state === "proposed";
  const [terms, withdrawalHref] = await Promise.all([proposed ? termsDisplayFor(store, market) : null, proposed ? withdrawalPageHref(store, market.slug) : null]);
  return (
    <>
      {/* Entered by a full page load, so no script an earlier page added is still here to read the token in the address. */}
      <PayRouteGuard store={store.slug} />
      <ExchangeView page={page} store={store} market={market} token={token} terms={terms} withdrawalHref={withdrawalHref} />
    </>
  );
}

/** The store's published withdrawal-information page (wave 1, 1e), as the shopper's market reaches it; null when the store has none. */
async function withdrawalPageHref(store: { id: string; slug: string; legalPages: Partial<Record<string, string>> }, marketSlug: string): Promise<string | null> {
  const id = store.legalPages.withdrawal_info;
  if (!id) return null;
  const published = (await listPublishedPages(store.id)).find((p) => p.id === id);
  return published ? marketPath(store.slug, marketSlug, `/${published.slug}`) : null;
}
