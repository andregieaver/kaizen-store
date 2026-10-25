"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { isLegalRole } from "@/lib/legal-roles";
import { languageNames } from "@/lib/legal-admin-words";
import { isStarterRole } from "@/lib/legal-starters";
import { actionAdminLang } from "@/server/admin-request-lang";
import { createLegalStarter, setLegalRole, setTermsMode } from "@/server/legal-starters";
import { askForLegalPage, runLegalWrites } from "@/server/legal-writer";
import { checkOwnerRole } from "@/server/permissions";

/**
 * The legal pages screen (wave 1, 1e, docs/wave-1-trust.md 2.1, 2.4): make a starter draft, choose the published page for a role, and say what
 * checkout shows about the terms. Owners only: each action asks for itself (`checkOwnerRole`) and the server functions hold the rule again.
 * A starter is only ever a draft; choosing a page is refused until it is published. Answers are in the account's language (D312 A8); what
 * the server functions refuse with stays as they write it.
 */

const denied = async (): Promise<FormState> => ({ status: "error", messages: [adminText(await actionAdminLang(), "legal").actions.noAccess] });
const refused = (problems: readonly string[]): FormState => ({ status: "error", messages: [...problems] });

/** Makes a draft starter of one kind from the store's own details, in its main language and the others among nb, sv, da and en. */
export async function createStarterAction(storeSlug: string, kind: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "legal").actions;
  if (!isStarterRole(kind)) return refused([w.noStarter]);
  const result = await createLegalStarter(member, kind);
  if (!result.ok) return refused(result.problems);
  refresh();
  const others = result.translations.length > 0 ? fillWords(w.writtenIn, { languages: languageNames(result.translations, lang) }) : "";
  return {
    status: "ok",
    messages: [fillWords(w.madeIn, { language: languageNames([result.language], lang), others, notice: result.translatedNotice ? w.englishNotice : "" })],
  };
}

/**
 * Asks the AI to write one kind of legal page (D311, unit L2): the write runs after the answer (and in the five-minute dispatcher should it
 * not finish) and saves a draft, never a published page.
 */
export async function writeWithAiAction(storeSlug: string, kind: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = adminText(adminLangOf(member.account.adminLocale), "legal").ai;
  const asked = await askForLegalPage(member, kind);
  if (!asked.ok) {
    const reason = asked.problems[0];
    return refused([reason === "country" || reason === "ai" || reason === "sources" ? w.unavailable[reason] : reason]);
  }
  if (!asked.already) after(() => runLegalWrites({}, 240_000));
  refresh();
  return { status: "ok", messages: [asked.already ? w.already : w.asked] };
}

/** Chooses one of the store's published pages for a legal role, or none. */
export async function setLegalRoleAction(storeSlug: string, role: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const w = adminText(adminLangOf(member.account.adminLocale), "legal").actions;
  if (!isLegalRole(role)) return refused([w.notLegal]);
  const chosen = String(formData.get("page") ?? "");
  if (chosen !== "" && !z.uuid().safeParse(chosen).success) return refused([w.choosePublished]);
  const result = await setLegalRole(member, role, chosen === "" ? null : chosen);
  if (!result.ok) return refused(result.problems);
  refresh();
  return { status: "ok", messages: [chosen === "" ? w.noneNow : w.chosen] };
}

/** What checkout shows about the terms: a link, a tick box or nothing. */
export async function setTermsModeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied();
  const result = await setTermsMode(member, String(formData.get("mode") ?? ""));
  if (!result.ok) return refused(result.problems);
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(member.account.adminLocale), "legal").actions.saved] };
}
