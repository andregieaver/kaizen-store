"use server";

import { actionAdminLang } from "@/server/admin-request-lang";
import { after } from "next/server";

import type { FormState } from "@/components/admin/action-form";
import { checkPermission } from "@/server/permissions";
import { storeAction } from "@/server/store-action";
import { decideRequest } from "@/server/support-actions";
import { carryOutRequest } from "@/server/support-carry-out";
import { memberDesk } from "@/server/support-desk";
import { sendRequestDecisionEmail } from "@/server/support-email";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";

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
  const w = SUPPORT_WORDS[await actionAdminLang()].problems;
  const member = await checkPermission(slug, "support:write", "support_desk");
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
    { byHand: true },
  );
  if (!result.ok) return { status: "error", messages: [result.problem] };
  after(() => sendRequestDecisionEmail(result.conversationId, actionId));
  return {
    status: "ok",
    messages: [decision === "done" ? w.markedDone : w.declinedTold],
  };
}

const refused = (message: string): FormState => ({
  status: "error",
  messages: [message],
});

/**
 * *Carry it out* on a staff request (ecosystem plan E2.7, D713), from the Requests page or the inbox: the order page's own function for its
 * kind, then the request marked done with the standard line for the customer. `support:write` opens it; `carryOutRequest()` asks
 * `orders:write` too, as the order page's actions do. For a refund the form sends the whole as it was shown (`expectMinor`), or a part
 * typed in the order's currency (`howMuch=part`, `amount`), and where it goes (`refundTo`). The store's slug and the request are bound first.
 */
export async function carryOutRequestAction(
  slug: string,
  actionId: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  return storeAction(
    {
      store: slug,
      key: "support:write",
      action: "support.carry_out",
      answer: refused,
    },
    async (member, lang) => {
      const shown = String(form.get("expectMinor") ?? "").trim();
      const expectMinor = /^\d{1,15}$/.test(shown) ? Number(shown) : null;
      const result = await carryOutRequest(
        member,
        actionId,
        {
          amount:
            form.get("howMuch") === "part"
              ? String(form.get("amount") ?? "").slice(0, 40)
              : null,
          expectMinor,
          toCredit: form.get("refundTo") === "credit",
        },
        lang,
      );
      if (!result.ok) return refused(result.problem);
      return { status: "ok", messages: [result.message] };
    },
  );
}
