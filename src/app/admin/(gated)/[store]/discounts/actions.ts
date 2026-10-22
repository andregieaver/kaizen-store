"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { discountProblemText, discountProblemsText } from "@/lib/discount-words";
import type { StoreDiscountInput } from "@/lib/discounts";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { deleteDiscount, generateCodes, saveDiscount } from "@/server/discounts";
import type { SaveResult } from "@/server/settings";

/** The refusal for a person without access, in their language (D312 A6). */
const noAccess = async () => adminText(await actionAdminLang(), "discounts").problems.noAccess;

/** Creates a code (id null) or changes one (D31); the server's refusals are said in the person's language. */
export async function saveDiscountAction(
  storeSlug: string,
  id: string | null,
  input: StoreDiscountInput,
): Promise<SaveResult & { id?: string }> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const w = adminText(adminLangOf(member.account.adminLocale), "discounts");
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problems: [w.problems.unknownCode] };
  const result = await saveDiscount(member, id, input);
  if (result.ok) {
    refresh();
    return result;
  }
  return { ...result, problems: discountProblemsText(result.problems, w) };
}

/** Deletes a code no order has used. */
export async function deleteDiscountAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const w = adminText(adminLangOf(member.account.adminLocale), "discounts");
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: [w.problems.unknownCode] };
  const result = await deleteDiscount(member, id);
  if (result.ok) redirect(`/admin/${member.store.slug}/discounts`);
  return { ...result, problems: discountProblemsText(result.problems, w) };
}

/** Makes single-use codes for a code that hands them out (D299 E1). */
export async function generateCodesAction(
  storeSlug: string,
  id: string,
  input: unknown,
): Promise<{ ok: true; made: number } | { ok: false; problem: string }> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const w = adminText(adminLangOf(member.account.adminLocale), "discounts");
  if (!z.uuid().safeParse(id).success) return { ok: false, problem: w.problems.unknownCode };
  const result = await generateCodes(member, id, input);
  if (result.ok) {
    refresh();
    return result;
  }
  return { ok: false, problem: discountProblemText(result.problem, w) };
}
