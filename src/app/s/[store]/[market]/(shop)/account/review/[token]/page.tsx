import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { StarRating } from "@/components/star-rating";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { invitationOf } from "@/server/review-requests";
import { reviewableLinesFor, reviewsOpen } from "@/server/reviews";
import { resolveFeatureShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/account/review/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The page a review request email opens (D301 G3, `docs/wave-5-marketing.md` 9.6): the order's received things, each with *Write a review* or the
 * buyer's review of it, without signing in. A spent or unknown link says the same as an expired one.
 */
export default function InvitedReviewsPage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <InvitedReviews params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function InvitedReviews({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "reviews");
  if (!shop) notFound();
  const { store, market } = shop;
  const r = t(market.lang).reviews;
  const invitation = await invitationOf(store.id, token);
  if (!invitation || !(await reviewsOpen(store.id))) {
    return (
      <>
        <h1 className="text-3xl font-heading tracking-tight">{r.request.pageTitle}</h1>
        <p role="alert">{invitation ? r.problem.closed : r.request.expired}</p>
      </>
    );
  }
  const lines = await reviewableLinesFor(store.id, invitation);
  const query = await searchParams;
  const base = marketPath(store.slug, market.slug);
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "medium" });
  const done = query.done === "waiting" ? r.sentWaiting : query.done === "shown" ? r.sentShown : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-heading tracking-tight">{r.request.pageTitle}</h1>
        <p className="text-muted">{r.request.pageIntro(invitation.orderNumber)}</p>
      </div>
      {done && (
        <p role="status" className="rounded-lg border border-border p-4">
          {done}
        </p>
      )}
      {lines.length === 0 ? (
        <p className="text-muted">{r.request.none}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lines.map((line) => (
            <li key={line.lineId} className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium">{line.title}</p>
                <p className="text-sm text-muted">{r.received(date(line.receivedAt))}</p>
                {line.review && (
                  <span className="mt-2 flex items-center gap-2">
                    <StarRating stars={line.review.rating} />
                    <span className="text-sm text-muted">{r.status[line.review.status]}</span>
                  </span>
                )}
              </div>
              <Link href={`${base}/account/review/${token}/${line.lineId}`} className="min-h-11 shrink-0 button-primary px-4 py-2 text-sm font-medium">
                {line.review ? r.change : r.write}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
