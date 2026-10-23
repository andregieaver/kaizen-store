"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { setPrice } from "@/server/ai-prices";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

/** Sets a model's price in dollars per million tokens, per picture, per audio minute and per million characters (D145, D146); the usage pages price calls with it from now (a model's first price from the beginning). */
export async function setAiPriceAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await setPrice(admin, form);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  const w = adminText(adminLangOf(admin.adminLocale), "platformTools").prices;
  return { status: "ok", messages: [result.first ? w.savedFirst : w.saved] };
}
