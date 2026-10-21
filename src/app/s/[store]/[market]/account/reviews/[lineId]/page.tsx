import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { defaultReviewName } from "@/lib/reviews";
import { getCustomer } from "@/server/customers";
import { reviewableLines } from "@/server/reviews";
import { resolveFeatureShop } from "@/server/shop";

import { deleteReviewAction, saveReviewAction } from "../actions";
import { ReviewForm } from "../review-form";

type Props = PageProps<"/s/[store]/[market]/account/reviews/[lineId]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Writing or changing a review of one received line (D301 9.3), and deleting it. Only the signed-in customer's own lines. */
export default function ReviewLinePage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <ReviewLine params={params} />
      </Suspense>
    </div>
  );
}

async function ReviewLine({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, lineId } = await params;
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "reviews");
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);
  if (!customer) redirect(`${base}/account`);
  if (!z.uuid().safeParse(lineId).success) notFound();
  const [line] = await reviewableLines(store.id, customer.id, { lineId });
  if (!line) notFound();
  const r = t(market.lang).reviews;
  const review = line.review;

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href={`${base}/account/reviews`} className="text-sm text-muted hover:underline">
          ← {r.back}
        </Link>
        <h1 className="text-3xl font-heading tracking-tight">{r.formTitle(line.title)}</h1>
        {review && <p className="text-sm text-muted">{r.status[review.status]}</p>}
      </div>
      <ReviewForm
        action={saveReviewAction.bind(null, store.slug, market.slug, line.lineId)}
        words={{
          rating: r.rating,
          stars: [1, 2, 3, 4, 5].map((n) => r.starsOf(n)),
          titleLabel: r.titleLabel,
          bodyLabel: r.bodyLabel,
          nameLabel: r.nameLabel,
          nameHint: r.nameHint,
          submit: review ? r.save : r.send,
          problems: r.problem,
        }}
        initial={{
          rating: review?.rating ?? null,
          title: review?.title ?? "",
          body: review?.body ?? "",
          name: review?.authorName ?? defaultReviewName(customer.name),
        }}
      />
      {review && (
        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium">{r.delete}</summary>
          <form action={deleteReviewAction.bind(null, store.slug, market.slug, review.id)} className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-muted">{r.deleteHint}</p>
            <button type="submit" className="min-h-11 self-start rounded-button border border-border px-4 font-medium">
              {r.deleteSure}
            </button>
          </form>
        </details>
      )}
    </>
  );
}
