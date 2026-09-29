"use server";

import { refresh, updateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import type { TranslateMode } from "@/lib/page-translate-ai";
import { TRANSLATE_SCOPES, type Unit } from "@/lib/store-translate";
import { requireMember } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { fieldsTag } from "@/server/custom-fields";
import { refreshStoreEmbeddings } from "@/server/embeddings";
import { pagesTag } from "@/server/pages";
import { STORES_TAG } from "@/server/seo";
import { applyTranslations, translationWorklist, type ApplyResult } from "@/server/store-translate";
import { storeTag } from "@/server/stores";

// Anyone who works on a store's products and pages can translate them; what the
// AI suggests is only written when staff accept it.

const worklistInput = z.object({
  locale: z.string().min(2).max(12),
  scopes: z.array(z.enum(TRANSLATE_SCOPES)).min(1),
  mode: z.enum(["missing", "all"]),
});

export type WorklistResult = { ok: true; units: Unit[]; total: number } | { ok: false; problem: string };

/** What there is to translate into a language, in the scopes chosen. */
export async function worklistAction(storeSlug: string, input: unknown): Promise<WorklistResult> {
  const member = await requireMember(storeSlug);
  const parsed = worklistInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: "Choose a language and something to translate." };
  if (!member.store.localization.locales.slice(1).includes(parsed.data.locale)) {
    return { ok: false, problem: "That is not one of the store's other languages." };
  }
  const { units, total } = await translationWorklist(member, parsed.data.locale, parsed.data.scopes, parsed.data.mode as TranslateMode);
  return { ok: true, units, total };
}

const acceptedInput = z.array(
  z.object({
    unitId: z.string().min(1).max(200),
    values: z.record(z.string().max(200), z.union([z.string().max(10_000), z.array(z.string().max(10_000)).max(400)])),
  }),
);

/** Writes what staff accepted: products' and menus' texts, custom fields' labels and values, and pages' drafts. */
export async function applyAction(storeSlug: string, locale: string, accepted: unknown): Promise<ApplyResult> {
  const member = await requireMember(storeSlug);
  const parsed = acceptedInput.safeParse(accepted);
  if (!parsed.success) return { ok: false, problem: "The translations could not be read. Reload the page and try again." };
  const result = await applyTranslations(member, locale, parsed.data);
  if (result.ok && result.saved > 0) {
    updateTag(catalogTag(member.store.id));
    updateTag(pagesTag(member.store.id));
    updateTag(fieldsTag(member.store.id));
    updateTag(storeTag(member.store.slug));
    updateTag(STORES_TAG);
    // Search by meaning follows the new texts.
    after(() => refreshStoreEmbeddings(member.store.id));
    refresh();
  }
  return result;
}
