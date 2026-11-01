"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { EVIDENCE_FIELDS } from "@/lib/dispute-evidence";
import { saveDisputeEvidence } from "@/server/dispute-evidence";
import { requirePermission } from "@/server/permissions";

/**
 * Keeps the evidence for a dispute as a draft, or sends it to Stripe (D417): `orders:write`. Sending needs the tick that the person read it and it is
 * true; without it nothing goes to Stripe, the draft is kept and the page says why.
 */
export async function saveEvidenceAction(storeSlug: string, orderId: string, disputeId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await requirePermission(storeSlug, "orders:write");
  const w = adminText(adminLangOf(member.account.adminLocale), "order").messages;
  const send = form.get("intent") === "send";
  if (send && form.get("confirm") !== "yes") return { status: "error", messages: [w.evidenceConfirm], fields: { confirm: w.evidenceConfirm } };
  const input = Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, String(form.get(f) ?? "")]));
  const outcome = await saveDisputeEvidence(member.store.id, member.account.id, orderId, disputeId, input, { send });
  if (outcome.ok) {
    refresh();
    return { status: "ok", messages: [outcome.sent ? w.evidenceSent : w.evidenceSaved] };
  }
  switch (outcome.reason) {
    case "invalid": {
      const fields = Object.fromEntries(Object.keys(outcome.fields).map((f) => [f, w.evidenceInvalid]));
      return { status: "error", messages: [w.evidenceInvalid], fields };
    }
    case "gone":
      return { status: "error", messages: [w.gone] };
    case "sent_before":
      return { status: "error", messages: [w.evidenceSentBefore] };
    case "not_answerable":
      return { status: "error", messages: [w.evidenceNotAnswerable] };
    case "not_connected":
      return { status: "error", messages: [w.evidenceNotConnected] };
    case "stripe_refused":
      return { status: "error", messages: [fillWords(w.evidenceRefused, { detail: outcome.detail ? `${outcome.detail.replace(/\.?$/, ".")}` : "" })] };
  }
}
