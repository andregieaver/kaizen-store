"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { marketPath } from "@/lib/paths";
import { cleanReview, reviewsTag } from "@/lib/reviews";
import { invitationOf } from "@/server/review-requests";
import { writeReviewAs } from "@/server/reviews";
import { resolveFeatureShop } from "@/server/shop";

import type { ReviewFormState } from "../../reviews/actions";

/**
 * Writes a review from a request email's link (D301 G3, `docs/wave-5-marketing.md` 9.6): the link is the proof, for its own order's lines only, in
 * the market's language; then back to the order's page with what became of it.
 */
export async function saveInvitedReviewAction(
  storeSlug: string,
  marketSlug: string,
  token: string,
  lineId: string,
  _state: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "reviews");
  if (!shop) return { problem: "closed" };
  const invitation = await invitationOf(shop.store.id, token);
  if (!invitation || !z.uuid().safeParse(lineId).success) return { problem: "not_reviewable" };
  const cleaned = cleanReview({ rating: form.get("rating"), title: form.get("title"), body: form.get("body"), name: form.get("name") });
  if (!cleaned.ok) return { problem: cleaned.problem };
  const outcome = await writeReviewAs(shop.store.id, invitation, lineId, cleaned.review, shop.market.locale);
  if (!outcome.ok) return { problem: outcome.problem };
  if (outcome.shownChanged) updateTag(reviewsTag(shop.store.id));
  redirect(marketPath(storeSlug, marketSlug, `/account/review/${token}?done=${outcome.status === "published" ? "shown" : "waiting"}`));
}
