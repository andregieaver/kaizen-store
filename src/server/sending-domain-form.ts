import "server-only";

import type { FormState } from "@/components/admin/action-form";
import type { NotificationsMessages } from "@/lib/admin-messages/notifications.en";

import type { Account } from "./auth";
import { addSendingDomain, checkSendingDomain, removeSendingDomain, setFromLocal, type SendingOwner } from "./sending-domains";

/**
 * The sending domain card's form for a store, for an account (D874), or for Kaizena Flow with no store (D727): the caller has checked the
 * person may change the store's settings (`settings:write`), owns the account, or may change the platform's (`settings`), and passes the card's words in the person's language; a refusal Resend
 * or the server gives in English is shown in theirs when known.
 */
export async function sendingDomainForm(account: Account, storeId: SendingOwner, form: FormData, w: NotificationsMessages["sendingDomain"]): Promise<FormState> {
  const refused = (problems: string[]): FormState => ({ status: "error", messages: problems.map((p) => w.problems[p] ?? p) });
  const intent = String(form.get("intent") ?? "");
  if (intent === "add") {
    const result = await addSendingDomain(account, storeId, { domain: String(form.get("domain") ?? ""), fromLocal: String(form.get("fromLocal") ?? "") });
    return result.ok ? { status: "ok", messages: [w.done.added] } : refused(result.problems);
  }
  if (intent === "check") {
    const result = await checkSendingDomain(account, storeId);
    return result.ok ? { status: "ok", messages: [w.done.checked] } : refused(result.problems);
  }
  if (intent === "address") {
    const result = await setFromLocal(account, storeId, String(form.get("fromLocal") ?? ""));
    return result.ok ? { status: "ok", messages: [w.done.saved] } : refused(result.problems);
  }
  if (intent === "remove") {
    const result = await removeSendingDomain(account, storeId);
    return result.ok ? { status: "ok", messages: [w.done.removed] } : refused(result.problems);
  }
  return { status: "error", messages: [w.noAccess] };
}
