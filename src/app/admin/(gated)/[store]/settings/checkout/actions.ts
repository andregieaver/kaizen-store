"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import type { FieldInputView, RuleInputView } from "@/components/admin/checkout-rules";
import { actionAdminLang } from "@/server/admin-request-lang";
import {
  deleteCheckoutField,
  deleteCheckoutRule,
  moveCheckoutRule,
  saveCheckoutField,
  saveCheckoutRule,
  switchCheckoutField,
  switchCheckoutRule,
} from "@/server/checkout-rules";
import type { AccountsMode } from "@/lib/customer-accounts";
import { saveAccountsMode } from "@/server/customer-accounts";
import { checkPermission } from "@/server/permissions";

/** Checkout rules and questions change what shoppers are offered and asked, so they are `settings:write` (D357). */
const noAccess = async () => adminText(await actionAdminLang(), "order").messages.noAccess;

export async function saveRuleAction(storeSlug: string, id: string | null, input: RuleInputView): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const saved = await saveCheckoutRule(member, id, input);
  if (saved.ok) refresh();
  return saved.ok ? { ok: true } : saved;
}

export async function switchRuleAction(storeSlug: string, id: string, on: boolean): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return;
  await switchCheckoutRule(member, id, on);
  refresh();
}

export async function moveRuleAction(storeSlug: string, id: string, by: -1 | 1): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return;
  await moveCheckoutRule(member, id, by === -1 ? -1 : 1);
  refresh();
}

export async function deleteRuleAction(storeSlug: string, id: string): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return;
  await deleteCheckoutRule(member, id);
  refresh();
}

export async function saveFieldAction(storeSlug: string, id: string | null, input: FieldInputView): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const saved = await saveCheckoutField(member, id, input);
  if (saved.ok) refresh();
  return saved.ok ? { ok: true } : saved;
}

export async function switchFieldAction(storeSlug: string, id: string, on: boolean): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return;
  await switchCheckoutField(member, id, on);
  refresh();
}

export async function deleteFieldAction(storeSlug: string, id: string): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return;
  await deleteCheckoutField(member, id);
  refresh();
}

/** Whether shoppers can, must or cannot have an account (D365): `settings:write`, refused while a feature or a company account needs them. */
export async function saveAccountsModeAction(storeSlug: string, mode: AccountsMode): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const lang = await actionAdminLang();
  const words = adminText(lang, "shipping").customerAccounts;
  const labels = adminText(lang, "common").features.labels as Record<string, string>;
  const saved = await saveAccountsMode(member, mode, words, (id) => labels[id] ?? id);
  if (saved.ok) refresh();
  return saved;
}
