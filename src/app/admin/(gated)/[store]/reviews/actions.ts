"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { reviewsTag } from "@/lib/reviews";
import { answerReview, hideReview, publishReview, savePublishMode, type Decided } from "@/server/reviews-admin";
import { requirePermission } from "@/server/permissions";

const PROBLEM: Record<Exclude<Decided, { ok: true }>["problem"], string> = {
  unknown: "That review is not in this store.",
  state: "The review changed meanwhile. Look at it again.",
  reason: "Choose why it is not shown.",
  answer: "The answer is too long: at most 2,000 characters.",
};

const done = (storeId: string, outcome: Decided, message: string): FormState => {
  if (!outcome.ok) return { status: "error", messages: [PROBLEM[outcome.problem]] };
  updateTag(reviewsTag(storeId));
  refresh();
  return { status: "ok", messages: [message] };
};

/** Publishes a review (D301 9.4, `products:write`, the Products section's). */
export async function publishReviewAction(storeSlug: string, reviewId: string, _state: FormState): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  if (!z.uuid().safeParse(reviewId).success) return { status: "error", messages: [PROBLEM.unknown] };
  return done(member.store.id, await publishReview(member.store.id, member.account.id, reviewId), "Published.");
}

/** Hides a review with one of the reasons a review may be hidden. */
export async function hideReviewAction(storeSlug: string, reviewId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  if (!z.uuid().safeParse(reviewId).success) return { status: "error", messages: [PROBLEM.unknown] };
  return done(member.store.id, await hideReview(member.store.id, member.account.id, reviewId, String(form.get("reason") ?? "")), "Hidden.");
}

/** Saves the store's answer under a review, or takes it away when empty. */
export async function answerReviewAction(storeSlug: string, reviewId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  if (!z.uuid().safeParse(reviewId).success) return { status: "error", messages: [PROBLEM.unknown] };
  const text = String(form.get("answer") ?? "");
  return done(member.store.id, await answerReview(member.store.id, member.account.id, reviewId, text), text.trim() ? "Answer saved." : "Answer taken away.");
}

/** Whether new reviews wait for a check or are published at once. */
export async function savePublishModeAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "products:write");
  const ok = await savePublishMode(member.store.id, member.account.id, String(form.get("publish") ?? ""));
  if (!ok) return { status: "error", messages: ["Choose one of the two."] };
  refresh();
  return { status: "ok", messages: ["Saved. Reviews already written keep their state."] };
}
