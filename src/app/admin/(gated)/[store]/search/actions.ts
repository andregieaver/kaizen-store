"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { splitWords } from "@/lib/search-synonyms";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { deleteRule, saveRule, type RuleResult } from "@/server/search-rules";
import { deleteSynonym, saveSynonym, type SynonymResult } from "@/server/search-synonyms";

/**
 * The Search page's synonyms and rules (wave 6 units F1 and F2, D324): each for a member with `settings:write`, the store's slug bound first. The writers
 * (`src/server/search-synonyms.ts`, `src/server/search-rules.ts`) check and audit; these carry the form to them and their problems back in the
 * member's language.
 */

type Problem = Extract<SynonymResult, { ok: false }>["problems"][number];
type RuleProblem = Extract<RuleResult, { ok: false }>["problems"][number];

/** Adds a group from the form: its language, its kind, the words and, one way, what they also find. */
export async function saveSynonymAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const w = adminText(adminLangOf(member.account.adminLocale), "bookings").search.synonyms;
  const text = (name: string) => String(formData.get(name) ?? "");
  const result = await saveSynonym(member, {
    locale: text("locale"),
    kind: text("kind"),
    words: splitWords(text("words")),
    means: splitWords(text("means")),
  });
  if (!result.ok) {
    const say = (problem: Problem) => (problem.code === "word" ? fillWords(w.problems.word, { word: problem.word }) : w.problems[problem.code]);
    return { status: "error", messages: [...new Set(result.problems.map(say))] };
  }
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** Takes a group away. */
export async function deleteSynonymAction(storeSlug: string, id: string, _state: FormState): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const w = adminText(adminLangOf(member.account.adminLocale), "bookings").search.synonyms;
  if (!(await deleteSynonym(member, id))) return { status: "error", messages: [w.gone] };
  refresh();
  return { status: "ok", messages: [w.removed] };
}

/** Adds a rule from the form: what to do, its product or category or tag, or its page, and the searches it is for. */
export async function saveRuleAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const w = adminText(adminLangOf(member.account.adminLocale), "bookings").search.rules;
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const result = await saveRule(member, {
    action: text("action"),
    productId: text("productId") || null,
    termId: text("termId") || null,
    target: text("target") || null,
    queries: text("queries").split(/[,\n]+/),
    match: text("match") || "contains",
    position: Number(text("position") || 0),
  });
  if (!result.ok) {
    const say = (problem: RuleProblem) => (problem.code === "query" ? fillWords(w.problems.query, { query: problem.query }) : w.problems[problem.code]);
    return { status: "error", messages: [...new Set(result.problems.map(say))] };
  }
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** Takes a rule away. */
export async function deleteRuleAction(storeSlug: string, id: string, _state: FormState): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const w = adminText(adminLangOf(member.account.adminLocale), "bookings").search.rules;
  if (!(await deleteRule(member, id))) return { status: "error", messages: [w.problems.gone] };
  refresh();
  return { status: "ok", messages: [w.removed] };
}
