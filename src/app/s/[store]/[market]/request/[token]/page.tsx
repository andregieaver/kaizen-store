import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { requestConfirmText } from "@/lib/request-confirm-text";
import { requestToConfirm } from "@/server/request-confirm";
import { resolveAfterSaleShop } from "@/server/shop";

import { confirmRequestAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/request/[token]">;

/** The link's address is a secret, so it is for no search engine and sends no referrer. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A request by email, confirmed from the order's own address (B3, D685, `src/server/request-confirm.ts`): what will be done, in code's own words,
 * and one Confirm. Opening the page changes nothing (a mail scanner may open it); only the button, a POST, confirms. It shows no address of the
 * customer's and nothing of the order but its number.
 */
export default function RequestConfirmPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 py-8">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <RequestConfirm params={params} />
      </Suspense>
    </div>
  );
}

async function RequestConfirm({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const request = await requestToConfirm(shop.store.id, token);
  if (!request) notFound();
  const w = requestConfirmText(shop.market.lang);
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-6" data-request-confirm={request.state}>
      <h1 className="text-xl font-semibold">{w.pageTitle}</h1>
      {request.state === "open" ? (
        <>
          <p>{w.pageIntro(request.orderNumber)}</p>
          <p className="rounded-md bg-surface p-3">{request.summary}</p>
          <form action={confirmRequestAction.bind(null, storeSlug, marketSlug, token)}>
            <button type="submit" className="inline-flex min-h-11 items-center button-primary rounded-button px-5 font-medium">
              {w.confirm}
            </button>
          </form>
        </>
      ) : (
        <p role="status">{request.state === "confirmed" ? w.confirmed : w.closed}</p>
      )}
    </section>
  );
}
