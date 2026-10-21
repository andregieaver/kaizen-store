"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { marketPath } from "@/lib/paths";
import { cleanReview, reviewsTag, type ReviewProblem } from "@/lib/reviews";
import { getCustomer } from "@/server/customers";
import { deleteOwnReview, writeReview } from "@/server/reviews";
import { resolveFeatureShop } from "@/server/shop";

/** What the review form shows after a press that did not go through: which problem, and the words typed (kept by the form). */
export type ReviewFormState = { problem: ReviewProblem | "not_reviewable" | "limit" | "closed" | null };

/**
 * Writes the signed-in customer's review of one of their received lines (D301 9.3), in the market's language; on success back to Reviews with what
 * became of it. A review shown at once, or a shown one edited, refreshes the store's reviews.
 */
export async function saveReviewAction(storeSlug: string, marketSlug: string, lineId: string, _state: ReviewFormState, form: FormData): Promise<ReviewFormState> {
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "reviews");
  if (!shop) return { problem: "closed" };
  const customer = await getCustomer(shop.store.id);
  if (!customer || !z.uuid().safeParse(lineId).success) return { problem: "not_reviewable" };
  const cleaned = cleanReview({ rating: form.get("rating"), title: form.get("title"), body: form.get("body"), name: form.get("name") });
  if (!cleaned.ok) return { problem: cleaned.problem };
  const outcome = await writeReview(shop.store.id, customer.id, lineId, cleaned.review, shop.market.locale);
  if (!outcome.ok) return { problem: outcome.problem };
  if (outcome.shownChanged) updateTag(reviewsTag(shop.store.id));
  redirect(marketPath(storeSlug, marketSlug, `/account/reviews?done=${outcome.status === "published" ? "shown" : "waiting"}`));
}

/** Deletes the customer's own review, after the form's *Yes, delete it* (D301 9.3). */
export async function deleteReviewAction(storeSlug: string, marketSlug: string, reviewId: string): Promise<void> {
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "reviews");
  const customer = shop ? await getCustomer(shop.store.id) : null;
  if (shop && customer && z.uuid().safeParse(reviewId).success) {
    const gone = await deleteOwnReview(shop.store.id, customer.id, reviewId);
    if (gone?.wasShown) updateTag(reviewsTag(shop.store.id));
  }
  redirect(marketPath(storeSlug, marketSlug, "/account/reviews?done=deleted"));
}
