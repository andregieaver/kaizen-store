"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { cleanReason, REASON_MAX, REASON_MIN } from "@/lib/store-closure";
import { requireAccount, type Account } from "@/server/auth";
import { closeStore, reopenStore, suspendStore, type ClosureResult } from "@/server/store-closure";
import { detachDryRun } from "@/server/theme-detach";

async function requirePlatformAdmin(): Promise<Account> {
  const account = await requireAccount();
  if (!account.platformAdmin) notFound();
  return account;
}

const unknown: FormState = { status: "error", messages: ["Unknown store."] };
const needReason: FormState = { status: "error", messages: [`Give a reason of ${REASON_MIN} to ${REASON_MAX} characters: the owner is told.`] };

function answer(result: ClosureResult, done: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [done, ...result.warnings] };
}

/** Suspends a store: sales stop and the shop cannot be changed. The reason goes to the owners (D171). */
export async function suspendStoreAction(storeId: string, _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!z.uuid().safeParse(storeId).success) return unknown;
  const reason = cleanReason(form.get("reason"));
  if (!reason) return needReason;
  return answer(await suspendStore(admin, storeId, reason), "The store is suspended and its owners are told.");
}

/** Closes a store for the platform: the same steps as the owner's, with a reason, and past what blocks an owner when forced (D171). */
export async function closeStoreForPlatformAction(storeId: string, _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!z.uuid().safeParse(storeId).success) return unknown;
  const reason = cleanReason(form.get("reason"));
  if (!reason) return needReason;
  return answer(await closeStore(admin, storeId, { by: "platform", reason, force: form.get("force") === "on" }), "The store is closed and its owners are told.");
}

/** Reopens a suspended or closed store, whenever (D171). */
export async function reopenStoreForPlatformAction(storeId: string, _state: FormState, _form: FormData): Promise<FormState> {
  void _state;
  void _form;
  const admin = await requirePlatformAdmin();
  if (!z.uuid().safeParse(storeId).success) return unknown;
  return answer(await reopenStore(admin, storeId, { by: "platform" }), "The store is open again and its owners are told.");
}

/**
 * The page migration of docs/theme-store.md 4.4 as a dry run (D241): how many of the store's page settings only repeat its theme and would
 * follow it once taken out, and how many are its own. Nothing is changed.
 */
export async function detachDryRunAction(storeId: string): Promise<FormState> {
  await requirePlatformAdmin();
  if (!z.uuid().safeParse(storeId).success) return unknown;
  const report = await detachDryRun(storeId);
  if (!report) return unknown;
  const lines = report.pages
    .slice(0, 10)
    .map((page) => `${page.title} (${page.type}): ${page.followed} would follow the theme, ${page.own} are its own.`);
  return {
    status: "ok",
    messages: [
      `Nothing was changed. Across ${report.pages.length} ${report.pages.length === 1 ? "page" : "pages"}: ${report.followed} ${report.followed === 1 ? "setting" : "settings"} would follow the theme, ${report.own} ${report.own === 1 ? "is" : "are"} the store's own.${report.unreadable > 0 ? ` ${report.unreadable} could not be read.` : ""}`,
      ...lines,
    ],
  };
}
