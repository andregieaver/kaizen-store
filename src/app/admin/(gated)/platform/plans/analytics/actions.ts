"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { catchUpPlatformSales } from "@/server/platform-sales";

/** *Read from Stripe* (D507): every paid invoice of the year read again into what Kaizena Flow sold. A platform admin's alone. */
export async function readSalesAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.sales;
  const year = Number(form.get("year"));
  const current = new Date().getUTCFullYear();
  const done = await catchUpPlatformSales(admin, Number.isInteger(year) && year >= 2024 && year <= current ? year : current);
  refresh();
  return { status: "ok", messages: [countWords(done.read, w.readDone)] };
}
