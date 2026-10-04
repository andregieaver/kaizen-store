"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { staffErase } from "@/server/privacy-admin";

/**
 * Step 2 of the erase page (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 3): the typed confirmation, then the run. Bound to the store's
 * slug, the customer's key and the request it answers (or "none") by the page. It asks `customers:write` first; a wrong confirmation changes
 * nothing; the server writes the audit entry and tells the owners. On success the staff member lands on the request, which shows what was done.
 */
export async function eraseCustomerAction(storeSlug: string, key: string, requestId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!z.uuid().safeParse(key).success) return { status: "error", messages: ["There is nobody with that key in this store."] };
  const request = z.uuid().safeParse(requestId).success ? requestId : null;
  const result = await staffErase({ storeId: member.store.id, accountId: member.account.id, requestId: request }, key, String(form.get("confirm") ?? ""));
  if (!result.ok) return { status: "error", messages: [result.message] };
  redirect(`/admin/${member.store.slug}/privacy/${result.requestId}`);
}
