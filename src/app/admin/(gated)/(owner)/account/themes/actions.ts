"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireAccount } from "@/server/auth";
import { withdrawSubmission } from "@/server/theme-submissions";

/** The author takes back a look not yet decided (D344). */
export async function withdrawSubmissionAction(submissionId: string): Promise<FormState> {
  const account = await requireAccount();
  const result = await withdrawSubmission(account, submissionId);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [] };
}
