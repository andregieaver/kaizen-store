"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { BonusResult } from "@/lib/bonus";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { adjustBonus } from "@/server/bonus";
import { findCustomer } from "@/server/customer-admin";
import { saveStaffFields } from "@/server/field-entities";
import { addTag, removeTag } from "@/server/segments";
import type { SaveResult } from "@/server/settings";

/**
 * Saves staff's custom fields for a customer with an account (D120). They are
 * for staff only and never shown on the site, so no cache tag is touched; the
 * server checks everything against the store's own groups.
 */
export async function saveCustomerFieldsAction(storeSlug: string, customerId: string, changes: unknown): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!z.uuid().safeParse(customerId).success) return { ok: false, problems: ["Unknown customer."] };
  const result = await saveStaffFields(member, "customer", customerId, changes);
  if (result.ok) refresh();
  return result;
}

/**
 * Adds credits to a customer's bonus balance, or takes some away (negative), with a reason the history keeps (D130).
 * Owners and admins both may; the server keeps the balance from going below zero and writes the audit log.
 */
export async function adjustBonusAction(storeSlug: string, customerId: string, amountMinor: number, note: string): Promise<BonusResult> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!z.uuid().safeParse(customerId).success) return { ok: false, problems: ["Unknown customer."] };
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) return { ok: false, problems: ["The amount must be a whole number of minor units, not 0."] };
  const result = await adjustBonus(member.account, member.store.id, customerId, amountMinor, String(note ?? ""));
  if (result.ok) refresh();
  return result;
}

/** Tags the person (D296), found by the page's own key; the address is read on the server, never sent by the browser. */
export async function addCustomerTagAction(storeSlug: string, key: string, form: FormData): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member || !z.uuid().safeParse(key).success) return;
  const ref = await findCustomer(member.store.id, key);
  if (!ref) return;
  await addTag(member.store.id, member.account.id, ref.email, String(form.get("tag") ?? ""));
  refresh();
}

export async function removeCustomerTagAction(storeSlug: string, key: string, tag: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member || !z.uuid().safeParse(key).success) return;
  const ref = await findCustomer(member.store.id, key);
  if (!ref) return;
  await removeTag(member.store.id, member.account.id, ref.email, tag);
  refresh();
}
