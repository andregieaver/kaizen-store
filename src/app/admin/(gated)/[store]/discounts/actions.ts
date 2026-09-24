"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { StoreDiscountInput } from "@/lib/discounts";
import { requireMember } from "@/server/auth";
import { deleteDiscount, saveDiscount } from "@/server/discounts";
import type { SaveResult } from "@/server/settings";

/** Creates a code (id null) or changes one (D31). */
export async function saveDiscountAction(
  storeSlug: string,
  id: string | null,
  input: StoreDiscountInput,
): Promise<SaveResult & { id?: string }> {
  const member = await requireMember(storeSlug);
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown code."] };
  const result = await saveDiscount(member, id, input);
  if (result.ok) refresh();
  return result;
}

/** Deletes a code no order has used. */
export async function deleteDiscountAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown code."] };
  const result = await deleteDiscount(member, id);
  if (result.ok) redirect(`/admin/${member.store.slug}/discounts`);
  return result;
}
