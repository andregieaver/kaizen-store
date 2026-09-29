"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireMember } from "@/server/auth";
import { saveStaffFields } from "@/server/field-entities";
import type { SaveResult } from "@/server/settings";

/**
 * Saves staff's custom fields for a customer with an account (D120). They are
 * for staff only and never shown on the site, so no cache tag is touched; the
 * server checks everything against the store's own groups.
 */
export async function saveCustomerFieldsAction(storeSlug: string, customerId: string, changes: unknown): Promise<SaveResult> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(customerId).success) return { ok: false, problems: ["Unknown customer."] };
  const result = await saveStaffFields(member, "customer", customerId, changes);
  if (result.ok) refresh();
  return result;
}
