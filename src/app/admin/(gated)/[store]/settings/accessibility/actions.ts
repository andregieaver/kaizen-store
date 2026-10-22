"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { languageNames } from "@/lib/legal-admin-words";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnerRole } from "@/server/permissions";
import { createStatementDraft, saveA11ySettings } from "@/server/accessibility";

/**
 * The accessibility page (wave 1, 1e, docs/wave-1-trust.md 2.3): what the owner says about the site's assessment, and a draft statement
 * made from it and from what the site itself knows. Owners only; each action asks for itself and the server functions refuse again.
 * "Meets the requirements" is refused without an assessor and a date, here, in the generator and in the database. Answers are in the
 * account's language (D312 A8); what the server functions refuse with stays as they write it.
 */

const denied = async (): Promise<FormState> => ({ status: "error", messages: [adminText(await actionAdminLang(), "legal").actions.noAccess] });

export async function saveAccessibilityAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") raw[key] = value;
  const result = await saveA11ySettings(member, raw);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(member.account.adminLocale), "legal").actions.saved] };
}

export async function createStatementAction(storeSlug: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const result = await createStatementDraft(member);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "legal").actions;
  const others = result.translations.length > 0 ? fillWords(w.statementOthers, { languages: languageNames(result.translations, lang) }) : "";
  return { status: "ok", messages: [fillWords(w.statementIn, { language: languageNames([result.language], lang), others })] };
}
