"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { postPlatformMoney, readPlatformPayouts, setPlatformBooks } from "@/server/platform-books";
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

/** The store whose books hold Kaizena Flow's money (D508), or none. A platform admin's alone. */
export async function setBooksStoreAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.books;
  const value = String(form.get("storeId") ?? "");
  const ok = await setPlatformBooks(admin, /^[0-9a-f-]{36}$/.test(value) ? value : null);
  if (!ok) return { status: "error", messages: [w.notOpen] };
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** *Post now* (D508): Kaizena Flow's live payouts of the year read from Stripe, then what is due posted to the books at once. */
export async function postBooksAction(): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.books;
  await readPlatformPayouts("live", `${new Date().getUTCFullYear()}-01-01`);
  const done = await postPlatformMoney({ deadline: Date.now() + 45_000 });
  refresh();
  const messages = [countWords(done.posted + done.payouts, w.postDone)];
  if (done.waiting > 0) messages.push(countWords(done.waiting, w.waiting));
  return { status: "ok", messages };
}
