"use server";

import { refresh, updateTag } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireAccount, type Account } from "@/server/auth";
import { addLanguage, LANGUAGES_TAG, listLanguages, setLanguageEnabled, setLanguageLocales, setPlatformSiteLanguage } from "@/server/languages";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { isPlatformLang } from "@/lib/platform-lang";
import { clearUiTexts, generateChunk, markUiReviewed, planGeneration, saveUiEdits, uiConnection, type ChunkResult, type GenerateMode } from "@/server/ui-text";
import { isBuiltIn } from "@/lib/ui-catalog-all";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";

const wordsOf = (account: Account) => adminText(adminLangOf(account.adminLocale), "platformTools").languages.actions;
const unknown = async () => adminText(await actionAdminLang(), "platformTools").languages.actions.unknown;

async function platformAdmin(): Promise<Account> {
  const account = await requireAccount();
  if (!account.platformAdmin) notFound();
  return account;
}

const changed = () => {
  updateTag(LANGUAGES_TAG);
  refresh();
};

/** Adds a language from the world's list (or by its code). */
export async function addLanguageAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await platformAdmin();
  const result = await addLanguage(account.id, String(formData.get("lang") ?? ""));
  if (!result.ok) return { status: "error", messages: [result.problem] };
  changed();
  return { status: "ok", messages: [wordsOf(account).added] };
}

export async function setEnabledAction(lang: string, enabled: boolean): Promise<FormState> {
  const account = await platformAdmin();
  const result = await setLanguageEnabled(account.id, lang, enabled);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  changed();
  return { status: "ok", messages: [enabled ? wordsOf(account).on : wordsOf(account).off] };
}

export async function saveLocalesAction(lang: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await platformAdmin();
  const locales = String(formData.get("locales") ?? "").split(/[\s,]+/).filter(Boolean);
  const result = await setLanguageLocales(account.id, lang, locales);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  changed();
  return { status: "ok", messages: [wordsOf(account).saved] };
}

const modeSchema = z.enum(["missing", "stale", "all"]);

async function target(lang: string) {
  const language = (await listLanguages()).find((l) => l.lang === lang);
  return language && !isBuiltIn(lang) ? language : null;
}

/** The texts a run would translate, as keys the browser then sends in chunks. */
export async function planAction(lang: string, mode: unknown): Promise<{ ok: true; keys: string[] } | { ok: false; problem: string }> {
  await platformAdmin();
  const parsed = modeSchema.safeParse(mode);
  if (!parsed.success || !(await target(lang))) return { ok: false, problem: await unknown() };
  return { ok: true, keys: await planGeneration(lang, parsed.data as GenerateMode) };
}

/** Translates some keys with Kaizen's AI; what passes the checks is kept as a draft. */
export async function generateAction(lang: string, keys: unknown): Promise<ChunkResult> {
  const account = await platformAdmin();
  const language = await target(lang);
  const parsed = z.array(z.string().max(200)).max(200).safeParse(keys);
  if (!language || !parsed.success) return { ok: false, problem: wordsOf(account).unknown };
  const connection = await uiConnection(account.id);
  if (!connection?.textModel) return { ok: false, problem: wordsOf(account).noModel };
  return generateChunk(connection, { accountId: account.id }, language, parsed.data);
}

/** A person's edits to one group of texts: only those that differ are saved, as reviewed. */
export async function saveGroupAction(lang: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await platformAdmin();
  if (!(await target(lang))) return { status: "error", messages: [wordsOf(account).unknown] };
  const edits: { key: string; text: string }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("t:") || typeof value !== "string") continue;
    const key = name.slice(2);
    const before = formData.get(`was:${key}`);
    if (typeof before === "string" && before === value) continue;
    if (value.trim() === "") continue;
    edits.push({ key, text: value });
  }
  if (edits.length === 0) return { status: "ok", messages: [wordsOf(account).nothingChanged] };
  const result = await saveUiEdits(account.id, lang, edits);
  if (!result.ok) return { status: "error", messages: result.problems.slice(0, 8).map((p) => `${p.key.replace(/^(ui|email):/, "")}: ${p.problem}`) };
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(account).savedCount, { n: result.saved })] };
}

/** Marks what a person has read: the shown texts, or every one not yet. */
export async function reviewAction(lang: string, keys: string[] | null): Promise<FormState> {
  const account = await platformAdmin();
  if (!(await target(lang))) return { status: "error", messages: [wordsOf(account).unknown] };
  const count = await markUiReviewed(account.id, lang, keys);
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(account).reviewed, { n: count })] };
}

export async function clearAction(lang: string): Promise<FormState> {
  const account = await platformAdmin();
  if (!(await target(lang))) return { status: "error", messages: [wordsOf(account).unknown] };
  const count = await clearUiTexts(account.id, lang);
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(account).removed, { n: count })] };
}

/** Offers Kaizena Flow's own site in a language, or stops (D312): refused while the language is not ready. */
export async function setSiteLanguageAction(lang: string, on: boolean): Promise<FormState> {
  const account = await platformAdmin();
  if (!isPlatformLang(lang)) return { status: "error", messages: [wordsOf(account).unknown] };
  const result = await setPlatformSiteLanguage(account.id, lang, on);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  updateTag(PLATFORM_NAVIGATION_TAG);
  refresh();
  return { status: "ok", messages: [on ? wordsOf(account).siteOn : wordsOf(account).siteOff] };
}
