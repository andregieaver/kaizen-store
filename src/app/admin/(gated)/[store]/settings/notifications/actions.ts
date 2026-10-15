"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { TEMPLATE_SLOTS, type EmailTemplate, type TemplateProblem, type TemplateSlot } from "@/lib/email-template";
import { checkPermission } from "@/server/permissions";
import { previewNotification, resetTemplate, saveTemplate, sendTestNotification, setNotification } from "@/server/notifications";

const NO_ACCESS = "You do not have access to change the store's emails.";

/**
 * The customer notifications' actions (wave 3, D238, `docs/wave-3-notifications.md` 2.1). Each asks the permission itself: seeing a preview is
 * `settings:read`, everything that changes something or sends an email `settings:write`. The server functions check the notification, the language and
 * the words again (`templateProblems()`), and write the audit entries; nothing here is cached, as emails read the store's words fresh.
 */

/** Switches one notification on or off (a row's form on the list). A required one is refused by `setNotification()`. */
export async function switchNotificationAction(storeSlug: string, id: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const enabled = form.get("enabled") === "on";
  const result = await setNotification(member.store.id, String(id), enabled, member.account.id);
  if (!result.ok) return { status: "error", messages: [result.message] };
  refresh();
  return { status: "ok", messages: [result.enabled ? "Switched on." : "Switched off."] };
}

/** The editor's draft as a template: only the three slots, as text. */
function draftOf(input: unknown): EmailTemplate {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return Object.fromEntries(TEMPLATE_SLOTS.map((slot) => [slot, typeof raw[slot] === "string" ? (raw[slot] as string).slice(0, 5000) : null])) as EmailTemplate;
}

export type PreviewAnswer =
  | { ok: true; subject: string; html: string; problems: TemplateProblem[]; fromTemplate: TemplateSlot[] }
  | { ok: false; message: string };

/** *Preview* (2.1 point 3): the email as it would be sent in one language with the sample order, the draft as typed. Read only. */
export async function previewNotificationAction(storeSlug: string, id: string, lang: string, draft: unknown): Promise<PreviewAnswer> {
  const member = await checkPermission(storeSlug, "settings:read");
  if (!member) return { ok: false, message: "You do not have access to the store's emails." };
  const preview = await previewNotification(member.store.id, String(id), String(lang), draft === null ? null : draftOf(draft));
  if (!preview) return { ok: false, message: "This email is not one Kaizen sends." };
  return {
    ok: true,
    subject: preview.email.subject,
    html: preview.email.html,
    problems: preview.problems,
    fromTemplate: TEMPLATE_SLOTS.filter((slot) => preview.slots.fromTemplate[slot]),
  };
}

export type SaveAnswer = { ok: true; message: string; deleted: boolean } | { ok: false; message: string; problems: TemplateProblem[] };

/** *Save* (2.1 point 5): the language's words; refused, with the problems, while anything is wrong. All three empty is the standard text again. */
export async function saveTemplateAction(storeSlug: string, id: string, lang: string, draft: unknown): Promise<SaveAnswer> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, message: NO_ACCESS, problems: [] };
  const result = await saveTemplate(member.store.id, String(id), String(lang), draftOf(draft), member.account.id);
  if (!result.ok) return { ok: false, message: result.message, problems: result.problem === "invalid" ? result.problems : [] };
  refresh();
  return { ok: true, deleted: result.deleted, message: result.deleted ? "Saved: the standard text is used." : "Saved." };
}

/** *Use standard text* (and *Delete* of a language no longer offered): the language's words are deleted. */
export async function resetTemplateAction(storeSlug: string, id: string, lang: string): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const result = await resetTemplate(member.store.id, String(id), String(lang), member.account.id);
  refresh();
  return result.ok ? { ok: true, message: "The standard text is used again." } : { ok: false, message: "There was no text of your own to remove." };
}

/** *Send a test* (2.1 point 4): the previewed email to the person's own address only, ten an hour. */
export async function sendTestNotificationAction(storeSlug: string, id: string, lang: string, draft: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const result = await sendTestNotification(member.store.id, String(id), String(lang), draft === null ? null : draftOf(draft), {
    id: member.account.id,
    email: member.account.email || null,
  });
  if (!result.ok) return { ok: false, message: result.message };
  const to = member.account.email || "your address";
  if (result.outcome === "logged") return { ok: true, message: `The test was written to the email log, but email is not set up here, so nothing reached ${to}.` };
  return { ok: true, message: `A test was sent to ${to}.` };
}
