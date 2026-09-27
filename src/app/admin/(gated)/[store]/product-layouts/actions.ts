"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { pagesTag } from "@/server/pages";
import { assignLayout } from "@/server/product-layouts";
import { termsTag } from "@/server/taxonomy";

/**
 * Where a product layout is used (D79): as the store's standard, and for
 * which product categories and tags. Products' pages follow at once.
 */
export async function assignLayoutAction(storeSlug: string, layoutId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(layoutId).success) return { status: "error", messages: ["Unknown layout."] };
  const termIds = form.getAll("term").map(String).filter((id) => z.uuid().safeParse(id).success);
  const result = await assignLayout(member.account, member.store.id, layoutId, { standard: form.get("standard") === "on", termIds });
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(catalogTag(member.store.id));
  updateTag(pagesTag(member.store.id));
  updateTag(termsTag({ storeId: member.store.id, contentType: "product" }));
  return { status: "ok", messages: ["Saved. Product pages use it where chosen."] };
}
