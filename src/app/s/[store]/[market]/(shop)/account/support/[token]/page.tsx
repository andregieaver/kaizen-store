import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PayRouteGuard } from "@/components/pay-route-guard";
import { SupportThread } from "@/components/chat/support-thread";
import { threadLabels } from "@/components/chat/thread-labels";
import { t } from "@/lib/i18n";
import { resolveShop } from "@/server/shop";
import { emailThread } from "@/server/support-route";

type Props = PageProps<"/s/[store]/[market]/account/support/[token]">;

/** Never indexed, and the address (which holds the token) is not passed on as a referrer. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A support conversation opened from its answer email (D216, `docs/support.md` 2.3, step 5): `/s/{store}/{market}/account/support/{token}`.
 * The token in the address is the whole access (only the newest email's opens it; only its hash is kept), so there is no sign-in and
 * no cookie, and the layout draws no tracking, owner code, chat or referral capture here (`isNoExtrasPath()`); it is entered by a full
 * page load. The customer reads the conversation and answers in it.
 */
export default function SupportLinkPage({ params }: Props) {
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
  const m = t(market.lang);
  const thread = await emailThread({ kind: "store", store, market }, token);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <PayRouteGuard store={store.slug} />
      <h1 className="font-heading text-2xl font-semibold">{m.chat.thread.title(store.name)}</h1>
      {thread ? (
        <>
          <p className="text-muted">{m.chat.thread.intro}</p>
          <SupportThread site={{ store: store.slug, market: market.slug }} conversation={thread.conversation} initial={thread.messages} initialState={thread.state} labels={threadLabels(market.lang)} />
        </>
      ) : (
        <p>{m.chat.thread.gone}</p>
      )}
    </div>
  );
}
