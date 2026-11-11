"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnerRole, checkPermission } from "@/server/permissions";
import {
  connectSms,
  deleteSmsCampaign,
  disconnectSms,
  previewSmsCampaign,
  saveSmsCampaign,
  saveSmsSettings,
  startSmsCampaign,
  stopByStaff,
  stopSmsCampaign,
  type SmsPreview,
} from "@/server/sms";

/**
 * SMS marketing's steps (D565), the store's slug the bound first argument. The account (connecting it, its rules, disconnecting) is the
 * OWNER's: it spends money and holds a password. Writing, pricing, sending and stopping texts is `marketing:write`. The server checks again.
 */

const noAccess = async () => ({ ok: false as const, problem: adminText(await actionAdminLang(), "inventory").noAccess });

export type SmsFormResult = { ok: true } | { ok: false; problem: string };

export async function connectSmsAction(storeSlug: string, form: Record<string, string>): Promise<SmsFormResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return noAccess();
  const result = await connectSms(member, form);
  if (result.ok) refresh();
  return result;
}

export async function saveSmsSettingsAction(storeSlug: string, form: Record<string, string>): Promise<SmsFormResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return noAccess();
  const result = await saveSmsSettings(member, form);
  if (result.ok) refresh();
  return result;
}

export async function disconnectSmsAction(storeSlug: string): Promise<SmsFormResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return noAccess();
  const result = await disconnectSms(member);
  if (result.ok) refresh();
  return result;
}

export async function stopNumberAction(storeSlug: string, id: string): Promise<SmsFormResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return noAccess();
  const result = await stopByStaff(member, String(id));
  if (result.ok) refresh();
  return result;
}

export type CampaignForm = { title: string; text: string; segmentId: string };

/** Saves the draft; a new one goes to its own page. */
export async function saveSmsCampaignAction(storeSlug: string, id: string | null, form: CampaignForm): Promise<SmsFormResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return noAccess();
  const result = await saveSmsCampaign(member, typeof id === "string" ? id : null, { title: form.title, text: form.text, segmentId: form.segmentId || null });
  if (!result.ok) return result;
  if (!id) redirect(`/admin/${member.store.slug}/text-messages/${result.id}`);
  refresh();
  return { ok: true };
}

export async function previewSmsCampaignAction(storeSlug: string, id: string): Promise<SmsPreview> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return noAccess();
  const result = await previewSmsCampaign(member, String(id));
  if (!result.ok) return result;
  // The page is shown the figures, not 46elks's raw units.
  return { ok: true, recipients: result.recipients, parts: result.parts, estimate: result.estimate, currency: result.currency, spent: result.spent, cap: result.cap, withinCap: result.withinCap, body: result.body };
}

export async function startSmsCampaignAction(storeSlug: string, id: string): Promise<SmsFormResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return noAccess();
  const result = await startSmsCampaign(member, String(id));
  if (result.ok) refresh();
  return result.ok ? { ok: true } : result;
}

export async function stopSmsCampaignAction(storeSlug: string, id: string): Promise<SmsFormResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return noAccess();
  const result = await stopSmsCampaign(member, String(id));
  if (result.ok) refresh();
  return result;
}

export async function deleteSmsCampaignAction(storeSlug: string, id: string): Promise<SmsFormResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return noAccess();
  const result = await deleteSmsCampaign(member, String(id));
  if (result.ok) redirect(`/admin/${member.store.slug}/text-messages`);
  return result;
}
