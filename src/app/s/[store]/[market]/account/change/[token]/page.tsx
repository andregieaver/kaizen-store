import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PayRouteGuard } from "@/components/pay-route-guard";
import type { LegalRole } from "@/lib/legal-roles";
import { marketPath } from "@/lib/paths";
import { changePageFor } from "@/server/order-edit-pay";
import { listPublishedPages } from "@/server/pages";
import { resolveShop } from "@/server/shop";

import { ChangeView } from "./change-view";

type Props = PageProps<"/s/[store]/[market]/account/change/[token]">;

/** Never indexed, and the address (which holds the token) is not passed on as a referrer. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The pay link of a change to a paid order, `/s/{store}/{market}/account/change/{token}` (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4): from the email a store sent after
 * changing an order to a higher total, or a link it shared. Built like a draft's pay link (D173): the token in the address is the whole access, so there is no sign-in and no cookie; only
 * its hash is kept, and a token of another store, an unknown or a malformed one, and one opened under another country's address are the same not-found page (it streams, so its status
 * line is sent first, as the hosted invoice does). The page is entered by a full page load and the layout draws no tracking, owner code, chat or referral capture on it
 * (`isNoExtrasPath()`). Its button opens Stripe's own hosted page; it loads no Stripe.js and sets nothing in the browser. Nothing is ticked: the order's own acceptance of the terms stands
 * (`docs/wave-3-fulfilment.md` section 8 item 4, for legal review).
 */
export default function ChangeLinkPage({ params }: Props) {
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
  const page = await changePageFor({ store, market }, token);
  if (page.state === "not_found") notFound();
  const open = page.state !== "paid" && page.state !== "ended";
  const [termsHref, withdrawalHref] = open ? await legalHrefs(store, market.slug, ["terms", "withdrawal_info"]) : [null, null];
  return (
    <>
      {/* Entered by a full page load, so no script an earlier page added is still here to read the token in the address. */}
      <PayRouteGuard store={store.slug} />
      <ChangeView page={page} store={store} market={market} token={token} termsHref={termsHref} withdrawalHref={withdrawalHref} />
    </>
  );
}

/** The store's published legal pages of these roles (wave 1, 1e), as the shopper's market reaches them; null for one it has not published. */
async function legalHrefs(
  store: { id: string; slug: string; legalPages: Partial<Record<LegalRole, string>> },
  marketSlug: string,
  roles: LegalRole[],
): Promise<(string | null)[]> {
  if (!roles.some((role) => store.legalPages[role])) return roles.map(() => null);
  const published = await listPublishedPages(store.id);
  return roles.map((role) => {
    const page = published.find((p) => p.id === store.legalPages[role]);
    return page ? marketPath(store.slug, marketSlug, `/${page.slug}`) : null;
  });
}
