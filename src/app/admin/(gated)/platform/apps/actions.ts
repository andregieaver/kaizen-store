"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { decideListing } from "@/server/developer-apps";

/** *Approve* or *Decline* an app's listing (D441 D3); a decline needs its reason, which the developer reads. A refusal is said on the form. */
export async function decideListingAction(appId: string, decision: "approved" | "declined", _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const note = form.get("note");
  const decided = await decideListing(admin, appId, decision === "approved" ? "approved" : "declined", typeof note === "string" ? note : "");
  if (!decided.ok) return { status: "error", messages: [decided.problem], fields: { note: decided.problem } };
  refresh();
  return { status: "ok", messages: [] };
}
