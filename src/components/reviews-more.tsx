"use client";

import { useState } from "react";

import type { ShownReview } from "@/lib/review-view";

import { ReviewItem, type ReviewWords } from "./review-item";

/**
 * *Show more reviews* (D301 9.5): the next ten published reviews from `/api/reviews`, drawn as the page draws its first ten. Without JavaScript the
 * first ten are what shows; the button is only drawn when there are more.
 */
export function ReviewsMore({
  endpoint,
  firstAfter,
  words,
  locale,
  store,
}: {
  /** `/api/reviews?…` for this store, market and product, without `after`. */
  endpoint: string;
  firstAfter: string;
  words: ReviewWords & { more: string; failed: string };
  locale: string;
  store: string;
}) {
  const [shown, setShown] = useState<ShownReview[]>([]);
  const [after, setAfter] = useState<string | null>(firstAfter);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function load() {
    if (!after) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`${endpoint}&after=${encodeURIComponent(after)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { reviews: ShownReview[]; more: boolean };
      setShown((s) => [...s, ...data.reviews]);
      setAfter(data.more && data.reviews.length > 0 ? data.reviews[data.reviews.length - 1].id : null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {shown.length > 0 && (
        <ul className="divide-y divide-border">
          {shown.map((review) => (
            <ReviewItem key={review.id} review={review} words={words} locale={locale} store={store} />
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className="text-sm">
          {words.failed}
        </p>
      )}
      {after && (
        <button type="button" onClick={load} disabled={busy} aria-busy={busy} className="min-h-11 self-start rounded-button border border-border px-4 text-sm font-medium">
          {words.more}
        </button>
      )}
    </>
  );
}
