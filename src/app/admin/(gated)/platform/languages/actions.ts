"use server";

import { refresh, updateTag } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireAccount, type Account } from "@/server/auth";
import { addLanguage, LANGUAGES_TAG, listLanguages, setLanguageEnabled, setLanguageLocales } from "@/server/languages";
import { clearUiTexts, generateChunk, markUiReviewed, planGeneration, saveUiEdits, uiConnection, type ChunkResult, type GenerateMode } from "@/server/ui-text";
import { isBuiltIn } from "@/lib/ui-catalog-all";

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
  return { status: "ok", messages: ["Language added."] };
}

export async function setEnabledAction(lang: string, enabled: boolean): Promise<FormState> {
  const account = await platformAdmin();
  const result = await setLanguageEnabled(account.id, lang, enabled);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  changed();
  return { status: "ok", messages: [enabled ? "Switched on." : "Switched off."] };
}

export async function saveLocalesAction(lang: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await platformAdmin();
  const locales = String(formData.get("locales") ?? "").split(/[\s,]+/).filter(Boolean);
  const result = await setLanguageLocales(account.id, lang, locales);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  changed();
  return { status: "ok", messages: ["Saved."] };
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
  if (!parsed.success || !(await target(lang))) return { ok: false, problem: "Unknown language." };
  return { ok: true, keys: await planGeneration(lang, parsed.data as GenerateMode) };
}

/** Translates some keys with Kaizen's AI; what passes the checks is kept as a draft. */
export async function generateAction(lang: string, keys: unknown): Promise<ChunkResult> {
  const account = await platformAdmin();
  const language = await target(lang);
  const parsed = z.array(z.string().max(200)).max(200).safeParse(keys);
  if (!language || !parsed.success) return { ok: false, problem: "Unknown language." };
  const connection = await uiConnection(account.id);
  if (!connection?.textModel) return { ok: false, problem: "Kaizen has no AI text model. Choose one under AI." };
  return generateChunk(connection, { accountId: account.id }, language, parsed.data);
}

/** A person's edits to one group of texts: only those that differ are saved, as reviewed. */
export async function saveGroupAction(lang: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await platformAdmin();
  if (!(await target(lang))) return { status: "error", messages: ["Unknown language."] };
  const edits: { key: string; text: string }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("t:") || typeof value !== "string") continue;
    const key = name.slice(2);
    const before = formData.get(`was:${key}`);
    if (typeof before === "string" && before === value) continue;
    if (value.trim() === "") continue;
    edits.push({ key, text: value });
  }
  if (edits.length === 0) return { status: "ok", messages: ["Nothing changed."] };
  const result = await saveUiEdits(account.id, lang, edits);
  if (!result.ok) return { status: "error", messages: result.problems.slice(0, 8).map((p) => `${p.key.replace(/^(ui|email):/, "")}: ${p.problem}`) };
  refresh();
  return { status: "ok", messages: [`${result.saved} saved.`] };
}

/** Marks what a person has read: the shown texts, or every one not yet. */
export async function reviewAction(lang: string, keys: string[] | null): Promise<FormState> {
  const account = await platformAdmin();
  if (!(await target(lang))) return { status: "error", messages: ["Unknown language."] };
  const count = await markUiReviewed(account.id, lang, keys);
  refresh();
  return { status: "ok", messages: [`${count} marked as reviewed.`] };
}

export async function clearAction(lang: string): Promise<FormState> {
  const account = await platformAdmin();
  if (!(await target(lang))) return { status: "error", messages: ["Unknown language."] };
  const count = await clearUiTexts(account.id, lang);
  refresh();
  return { status: "ok", messages: [`${count} texts removed.`] };
}
