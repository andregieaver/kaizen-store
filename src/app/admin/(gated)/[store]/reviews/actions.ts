"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import type { ReviewsMessages } from "@/lib/admin-messages/reviews.en";
import { adminText } from "@/lib/admin-text";
import { reviewsTag } from "@/lib/reviews";
import { answerReview, hideReview, publishReview, savePublishMode, saveRequestSettings, type Decided } from "@/server/reviews-admin";
import { requirePermission } from "@/server/permissions";

type Words = ReviewsMessages["actions"];

/** What the actions answer, in the account's language (D312 A5). */
const wordsOf = (member: { account: { adminLocale?: string | null } }): Words => adminText(adminLangOf(member.account.adminLocale), "reviews").actions;

const problem = (w: Words): Record<Exclude<Decided, { ok: true }>["problem"], string> => ({
  unknown: w.unknown,
  state: w.state,
  reason: w.reason,
  answer: w.answer,
});

const done = (storeId: string, w: Words, outcome: Decided, message: string): FormState => {
  if (!outcome.ok) return { status: "error", messages: [problem(w)[outcome.problem]] };
  updateTag(reviewsTag(storeId));
  refresh();
  return { status: "ok", messages: [message] };
};

/** Publishes a review (D301 9.4, `products:write`, the Products section's). */
export async function publishReviewAction(storeSlug: string, reviewId: string, _state: FormState): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  if (!z.uuid().safeParse(reviewId).success) return { status: "error", messages: [w.unknown] };
  return done(member.store.id, w, await publishReview(member.store.id, member.account.id, reviewId), w.published);
}

/** Hides a review with one of the reasons a review may be hidden. */
export async function hideReviewAction(storeSlug: string, reviewId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  if (!z.uuid().safeParse(reviewId).success) return { status: "error", messages: [w.unknown] };
  return done(member.store.id, w, await hideReview(member.store.id, member.account.id, reviewId, String(form.get("reason") ?? "")), w.hidden);
}

/** Saves the store's answer under a review, or takes it away when empty. */
export async function answerReviewAction(storeSlug: string, reviewId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  if (!z.uuid().safeParse(reviewId).success) return { status: "error", messages: [w.unknown] };
  const text = String(form.get("answer") ?? "");
  return done(member.store.id, w, await answerReview(member.store.id, member.account.id, reviewId, text), text.trim() ? w.answerSaved : w.answerRemoved);
}

/** Whether new reviews wait for a check or are published at once. */
export async function savePublishModeAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  const ok = await savePublishMode(member.store.id, member.account.id, String(form.get("publish") ?? ""));
  if (!ok) return { status: "error", messages: [w.chooseOne] };
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** Whether review request emails go, and how many days after receipt (D301 G3). */
export async function saveRequestSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const w = wordsOf(member);
  const ok = await saveRequestSettings(member.store.id, member.account.id, { on: form.get("requests") === "on", days: Number(form.get("days")) });
  if (!ok) return { status: "error", messages: [w.days] };
  refresh();
  return { status: "ok", messages: [w.requestsSaved] };
}
