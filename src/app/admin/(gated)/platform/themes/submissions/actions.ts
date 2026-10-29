"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { DESIGNS_TAG } from "@/server/design-presets";
import { platformSiteWords } from "@/server/platform-site-words";
import { STARTERS_TAG, joinStarter } from "@/server/store-starters";
import { approveSubmission, getSubmission, rejectSubmission, reviewSubmission } from "@/server/theme-submissions";

/** Takes a submission into review (D344): a draft theme made from its look, nothing yet for stores. */
export async function reviewSubmissionAction(submissionId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await reviewSubmission(admin, submissionId);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: result.notes };
}

/** Approves a submission in review (D344): its theme published, in the theme store. */
export async function approveSubmissionAction(submissionId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await approveSubmission(admin, submissionId);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  updateTag(STARTERS_TAG);
  refresh();
  return { status: "ok", messages: result.notes };
}

/** Says a submission is not accepted, and why (D344). */
export async function rejectSubmissionAction(submissionId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const reason = formData.get("reason");
  const result = await rejectSubmission(admin, submissionId, typeof reason === "string" ? reason : "");
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(DESIGNS_TAG);
  refresh();
  return { status: "ok", messages: [] };
}

/** Opens a submission's pages (D388) in their store admin, to read them before deciding: the platform admin is made its owner (`joinStarter()`). */
export async function openSubmissionPagesAction(submissionId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const submission = await getSubmission(admin, submissionId);
  if (!submission?.contentStarterId) return { status: "error", messages: [(await platformSiteWords()).w.submissions.pagesNotPlaced] };
  const joined = await joinStarter(admin, submission.contentStarterId);
  if (!joined.ok) return { status: "error", messages: joined.problems };
  redirect(`/admin/${joined.slug}`);
}
