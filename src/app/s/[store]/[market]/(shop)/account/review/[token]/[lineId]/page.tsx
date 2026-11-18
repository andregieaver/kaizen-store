import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { defaultReviewName } from "@/lib/reviews";
import { invitationOf } from "@/server/review-requests";
import { reviewableLinesFor } from "@/server/reviews";
import { reviewPictureStorage } from "@/server/review-picture-store";
import { resolveFeatureShop } from "@/server/shop";

import { reviewFormPictures, reviewFormWords } from "../../../reviews/form-words";
import { ReviewForm } from "../../../reviews/review-form";
import { saveInvitedReviewAction } from "../actions";

type Props = PageProps<"/s/[store]/[market]/account/review/[token]/[lineId]">;

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Writing or changing a review of one line of the order a request email's link opens (D301 G3), without signing in. */
export default function InvitedReviewLinePage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <InvitedReviewLine params={params} />
      </Suspense>
    </div>
  );
}

async function InvitedReviewLine({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, token, lineId } = await params;
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "reviews");
  if (!shop) notFound();
  const { store, market } = shop;
  const invitation = await invitationOf(store.id, token);
  if (!invitation || !z.uuid().safeParse(lineId).success) notFound();
  const [line] = await reviewableLinesFor(store.id, invitation, { lineId });
  if (!line) notFound();
  const r = t(market.lang).reviews;
  const review = line.review;

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href={`${marketPath(store.slug, market.slug)}/account/review/${token}`} className="text-sm text-muted hover:underline">
          ← {r.request.back}
        </Link>
        <h1 className="text-3xl font-heading tracking-tight">{r.formTitle(line.title)}</h1>
        {review && <p className="text-sm text-muted">{r.status[review.status]}</p>}
      </div>
      <ReviewForm
        action={saveInvitedReviewAction.bind(null, store.slug, market.slug, token, line.lineId)}
        words={reviewFormWords(r, review)}
        pictures={reviewFormPictures(review, reviewPictureStorage() !== null, false)}
        initial={{
          rating: review?.rating ?? null,
          title: review?.title ?? "",
          body: review?.body ?? "",
          name: review?.authorName ?? defaultReviewName(invitation.name),
        }}
      />
    </>
  );
}
