"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { after } from "next/server";

import type { FormState } from "@/components/admin/action-form";
import { checkPermission } from "@/server/permissions";
import { decideRequest } from "@/server/support-actions";
import { memberDesk } from "@/server/support-desk";
import { sendRequestDecisionEmail } from "@/server/support-email";

/**
 * Done or Decline on a staff request of the store's desk (D216, step 10): `support:write`. The customer's email, when they are away,
 * goes after the answer. The store's slug and the request are bound first.
 */
export async function decideRequestAction(
  slug: string,
  actionId: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const member = await checkPermission(slug, "support:write");
  if (!member) return { status: "error", messages: [w.noAccess] };
  const decision = form.get("decision");
  if (decision !== "done" && decision !== "declined")
    return { status: "error", messages: [w.chooseDecision] };
  const note = form.get("note");
  const result = await decideRequest(
    memberDesk(member),
    actionId,
    decision,
    typeof note === "string" ? note : null,
  );
  if (!result.ok) return { status: "error", messages: [result.problem] };
  after(() => sendRequestDecisionEmail(result.conversationId, actionId));
  return {
    status: "ok",
    messages: [decision === "done" ? w.markedDone : w.declinedTold],
  };
}
