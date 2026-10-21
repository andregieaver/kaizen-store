import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { StarRating } from "@/components/star-rating";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { getCustomer } from "@/server/customers";
import { reviewsForAccount } from "@/server/reviews";
import { resolveFeatureShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/account/reviews">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * My account's Reviews (D301, `docs/wave-5-marketing.md` 9.3): what the signed-in customer bought and received, each with *Write a review* or their
 * review of it and its state. Only while the store has reviews on.
 */
export default function AccountReviewsPage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <AccountReviews params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AccountReviews({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "reviews");
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);
  if (!customer) redirect(`${base}/account`);
  const r = t(market.lang).reviews;
  const query = await searchParams;
  const { open, lines } = await reviewsForAccount(store.id, customer.id);
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "medium" });
  const done = query.done === "waiting" ? r.sentWaiting : query.done === "shown" ? r.sentShown : query.done === "deleted" ? r.deleted : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href={`${base}/account`} className="text-sm text-muted hover:underline">
          ← {t(market.lang).account.title}
        </Link>
        <h1 className="text-3xl font-heading tracking-tight">{r.title}</h1>
        <p className="text-muted">{open ? r.intro : r.problem.closed}</p>
      </div>
      {done && (
        <p role="status" className="rounded-lg border border-border p-4">
          {done}
        </p>
      )}
      {open && lines.length === 0 && <p className="text-muted">{r.none}</p>}
      {lines.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lines.map((line) => (
            <li key={line.lineId} className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium">{line.title}</p>
                <p className="text-sm text-muted">{r.received(date(line.receivedAt))}</p>
                {line.review && (
                  <div className="mt-2 flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <StarRating stars={line.review.rating} />
                      <span className="text-sm text-muted">{r.status[line.review.status]}</span>
                    </span>
                    {line.review.title && <p className="font-medium">{line.review.title}</p>}
                    {line.review.body && <p className="whitespace-pre-line text-sm">{line.review.body}</p>}
                    {line.review.answer && (
                      <p className="mt-1 border-l-2 border-border pl-3 text-sm">
                        <span className="block text-muted">{r.answerFrom(store.name)}</span>
                        <span className="whitespace-pre-line">{line.review.answer}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
              <Link href={`${base}/account/reviews/${line.lineId}`} className="min-h-11 shrink-0 button-primary px-4 py-2 text-sm font-medium">
                {line.review ? r.change : r.write}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
