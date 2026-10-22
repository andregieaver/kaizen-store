"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { adminText } from "@/lib/admin-text";
import { TEMPLATE_SLOTS, type EmailTemplate, type TemplateProblem, type TemplateSlot } from "@/lib/email-template";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { previewNotification, resetTemplate, saveTemplate, sendTestNotification, setNotification } from "@/server/notifications";

/** The words of a member's language, or of the request's before a member is known. */
const wordsOf = async (member: Membership | null) => adminText(member ? adminLangOf(member.account.adminLocale) : await actionAdminLang(), "notifications");

/** A refusal of the notification server functions, by its kind, in the person's words; one not known stays as written. */
function refusal(result: { problem: string; message: string }, w: NotificationsMessages["answers"]): string {
  const limit = /^You have sent (\d+) test emails this hour\. You can send another after (.+) UTC\.$/.exec(result.message);
  if (limit) return fillWords(w.limit, { n: limit[1], at: limit[2] });
  const known: Record<string, string> = { unknown: w.unknown, required: w.required, locked: w.locked, language: w.language, invalid: w.invalid, no_address: w.noAddress };
  return known[result.problem] ?? result.message;
}

/**
 * The customer notifications' actions (wave 3, D238, `docs/wave-3-notifications.md` 2.1). Each asks the permission itself: seeing a preview is
 * `settings:read`, everything that changes something or sends an email `settings:write`. The server functions check the notification, the language and
 * the words again (`templateProblems()`), and write the audit entries; nothing here is cached, as emails read the store's words fresh.
 */

/** Switches one notification on or off (a row's form on the list). A required one is refused by `setNotification()`. */
export async function switchNotificationAction(storeSlug: string, id: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  const words = await wordsOf(member);
  if (!member) return { status: "error", messages: [words.answers.noAccess] };
  const enabled = form.get("enabled") === "on";
  const result = await setNotification(member.store.id, String(id), enabled, member.account.id);
  if (!result.ok) return { status: "error", messages: [refusal(result, words.answers)] };
  refresh();
  return { status: "ok", messages: [result.enabled ? words.common.switchedOn : words.common.switchedOff] };
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
  const words = await wordsOf(member);
  if (!member) return { ok: false, message: words.answers.noReadAccess };
  const preview = await previewNotification(member.store.id, String(id), String(lang), draft === null ? null : draftOf(draft));
  if (!preview) return { ok: false, message: words.answers.unknown };
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
  const words = await wordsOf(member);
  if (!member) return { ok: false, message: words.answers.noAccess, problems: [] };
  const result = await saveTemplate(member.store.id, String(id), String(lang), draftOf(draft), member.account.id);
  if (!result.ok) return { ok: false, message: refusal(result, words.answers), problems: result.problem === "invalid" ? result.problems : [] };
  refresh();
  return { ok: true, deleted: result.deleted, message: result.deleted ? words.answers.savedStandard : words.common.saved };
}

/** *Use standard text* (and *Delete* of a language no longer offered): the language's words are deleted. */
export async function resetTemplateAction(storeSlug: string, id: string, lang: string): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  const words = await wordsOf(member);
  if (!member) return { ok: false, message: words.answers.noAccess };
  const result = await resetTemplate(member.store.id, String(id), String(lang), member.account.id);
  refresh();
  return result.ok ? { ok: true, message: words.answers.standardAgain } : { ok: false, message: words.answers.nothingToRemove };
}

/** *Send a test* (2.1 point 4): the previewed email to the person's own address only, ten an hour. */
export async function sendTestNotificationAction(storeSlug: string, id: string, lang: string, draft: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  const words = await wordsOf(member);
  if (!member) return { ok: false, message: words.answers.noAccess };
  const result = await sendTestNotification(member.store.id, String(id), String(lang), draft === null ? null : draftOf(draft), {
    id: member.account.id,
    email: member.account.email || null,
  });
  if (!result.ok) return { ok: false, message: refusal(result, words.answers) };
  const to = member.account.email || words.answers.yourAddress;
  if (result.outcome === "logged") return { ok: true, message: fillWords(words.answers.loggedTo, { to }) };
  return { ok: true, message: fillWords(words.answers.sentTo, { to }) };
}
