"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatform } from "@/server/auth";
import { isBriefingKind, isTargetMetric } from "@/lib/platform-briefing";
import { postPlatformMoney, setPlatformBooks } from "@/server/platform-books";
import { savePlatformTarget, setPlatformBriefing } from "@/server/platform-briefing";
import { readPlatformPayouts } from "@/server/platform-payouts";
import { catchUpPlatformSales } from "@/server/platform-sales";
import { bankAmount } from "@/lib/bank-statement";
import { removePlatformSpend, savePlatformSpend } from "@/server/platform-channels";
import { platformModes } from "@/server/stripe";

/** *Read from Stripe* (D507, D509): every paid invoice and payout of the year read again. A platform admin's alone. */
export async function readSalesAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatform("plans");
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.sales;
  const year = Number(form.get("year"));
  const current = new Date().getUTCFullYear();
  const chosen = Number.isInteger(year) && year >= 2024 && year <= current ? year : current;
  const done = await catchUpPlatformSales(admin, chosen);
  // The year's payouts too, in each mode, with what each carried (D509).
  let payouts = 0;
  for (const mode of platformModes()) payouts += await readPlatformPayouts(mode, `${chosen}-01-01`);
  refresh();
  return { status: "ok", messages: [countWords(done.read, w.readDone), countWords(payouts, w.payoutsDone)] };
}

/** The store whose books hold Kaizena Flow's money (D508), or none. A platform admin's alone. */
export async function setBooksStoreAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatform("plans");
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.books;
  const value = String(form.get("storeId") ?? "");
  const ok = await setPlatformBooks(admin, /^[0-9a-f-]{36}$/.test(value) ? value : null);
  if (!ok) return { status: "error", messages: [w.notOpen] };
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** *Post now* (D508): Kaizena Flow's live payouts of the year read from Stripe, then what is due posted to the books at once. */
export async function postBooksAction(): Promise<FormState> {
  const admin = await requirePlatform("plans");
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.books;
  await readPlatformPayouts("live", `${new Date().getUTCFullYear()}-01-01`);
  const done = await postPlatformMoney({ deadline: Date.now() + 45_000 });
  refresh();
  const messages = [countWords(done.posted + done.payouts, w.postDone)];
  if (done.waiting > 0) messages.push(countWords(done.waiting, w.waiting));
  return { status: "ok", messages };
}

/** Sets one of this month's targets (D513), or takes it away with 0. The plans area's (an owner or the finance role). */
export async function setTargetAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatform("plans");
  const w = adminText(adminLangOf(admin.adminLocale), "platform").briefing;
  const metric = String(form.get("metric") ?? "");
  const month = String(form.get("month") ?? "");
  const currency = String(form.get("currency") ?? "").trim().toUpperCase() || null;
  const raw = String(form.get("value") ?? "").replace(/\s/g, "").replace(",", ".");
  const number = Number(raw);
  if (!isTargetMetric(metric) || !Number.isFinite(number) || number < 0) return { status: "error", messages: [w.targetInvalid] };
  // Money is typed in whole units and kept in minor units; counts as they are.
  const value = metric === "mrr" || metric === "sales" ? Math.round(number * 100) : Math.round(number);
  const ok = await savePlatformTarget(admin, { metric, month, currency, targetValue: value });
  if (!ok) return { status: "error", messages: [w.targetInvalid] };
  refresh();
  return { status: "ok", messages: [w.targetSaved] };
}

/** The morning briefing (D513): daily, weekly or off, or its offer put away. The plans area's (an owner or the finance role). */
export async function setBriefingAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatform("plans");
  const w = adminText(adminLangOf(admin.adminLocale), "platform").briefing;
  const choice = String(form.get("briefing") ?? "");
  if (!(isBriefingKind(choice) || choice === "dismiss") || !(await setPlatformBriefing(admin, choice))) return { status: "error", messages: [w.targetInvalid] };
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** *Add spend* (C2, D522): what Kaizena Flow spent on a channel on a day; the amount in its currency's whole units. The plans area's. */
export async function savePlatformSpendAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatform("plans");
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.channels;
  const currency = String(form.get("currency") ?? "").trim().toUpperCase();
  const saved = await savePlatformSpend(admin, {
    day: String(form.get("day") ?? ""),
    channel: String(form.get("channel") ?? ""),
    campaign: String(form.get("campaign") ?? ""),
    amountMinor: /^[A-Z]{3}$/.test(currency) ? bankAmount(String(form.get("amount") ?? ""), currency) : null,
    currency,
    note: String(form.get("note") ?? ""),
  });
  if (!saved.ok) return { status: "error", messages: [w.problems[saved.problem]], fields: { [saved.problem]: w.problems[saved.problem] } };
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** *Remove* beside a spend row (D522). */
export async function removePlatformSpendAction(id: string): Promise<FormState> {
  const admin = await requirePlatform("plans");
  const w = adminText(adminLangOf(admin.adminLocale), "console").planAnalytics.channels;
  if (!(await removePlatformSpend(admin, id))) return { status: "error", messages: [w.problems.plans] };
  refresh();
  return { status: "ok", messages: [w.removed] };
}
