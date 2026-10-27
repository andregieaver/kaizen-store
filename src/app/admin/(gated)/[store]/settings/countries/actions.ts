"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { PRICE_BASES, ruleProblem } from "@/lib/market-prices";
import { marketPriceRules, previewRule, removeMarketPriceRule, saveMarketPriceRule, type RulePreview } from "@/server/market-prices";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { pagesTag } from "@/server/pages";
import { STORES_TAG } from "@/server/seo";
import { setMarkets } from "@/server/setup";
import { forgetStoreFacts } from "@/server/redirect-resolve";
import { storeTag } from "@/server/stores";

/**
 * The countries the store sells to (D178), from the Countries settings (`settings:write`), through the setup wizard's `setMarkets()`. The
 * storefront, its catalogue, sitemap and pages follow, so their caches are cleared.
 */
export async function saveCountriesSettingsAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await checkPermission(storeSlug, "settings:write");
  if (!owner) return { status: "error", messages: [adminText(await actionAdminLang(), "settings").common.noChange] };
  const codes = formData
    .getAll("country")
    .map(String)
    .filter((code) => /^[A-Z]{2}$/.test(code));
  const result = await setMarkets(owner, codes);
  const w = adminText(adminLangOf(owner.account.adminLocale), "settings").countries;
  const said = (text: string) => w.problems[text] ?? text;
  if (!result.ok) return { status: "error", messages: result.problems.map(said) };
  updateTag(storeTag(owner.store.slug));
  // The shape of its addresses (D181), as the proxy reads it.
  forgetStoreFacts(owner.store.slug);
  updateTag(catalogTag(owner.store.id));
  updateTag(pagesTag(owner.store.id));
  updateTag(STORES_TAG);
  refresh();
  return { status: "ok", messages: [result.note ? said(result.note) : w.saved] };
}

// ---------------------------------------------------------------------------
// Market price rules (wave 7 unit A2, D335): a country's prices worked out from another's, previewed, saved and taken away here.
// ---------------------------------------------------------------------------

const ruleInput = z.object({
  market: z.string().regex(/^[A-Z]{2}$/),
  base: z.string().regex(/^[A-Z]{2}$/),
  percentBps: z.number().int(),
  basis: z.enum(PRICE_BASES),
  roundToMinor: z.number().int(),
  endingMinor: z.number().int().nullable(),
});

const refreshPrices = (storeId: string, slug: string) => {
  updateTag(catalogTag(storeId));
  updateTag(storeTag(slug));
  refresh();
};

/** Five of the store's products' prices under the rule as typed, before it is saved. */
export async function previewPriceRuleAction(storeSlug: string, given: unknown): Promise<RulePreview[] | { problem: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { problem: adminText(await actionAdminLang(), "settings").common.noChange };
  const parsed = ruleInput.safeParse(given);
  if (!parsed.success) return { problem: adminText(adminLangOf(member.account.adminLocale), "settings").priceRules.unreadable };
  const problem = ruleProblem(parsed.data, member.store.keptMarkets.map((m) => m.code), await marketPriceRules(member.store.id));
  if (problem) return { problem: priceRuleProblem(member, problem) };
  return previewRule(member.store.id, parsed.data, member.store.localization.locales[0] ?? "en");
}

/** Saves the rule and works out its prices at once. */
export async function savePriceRuleAction(storeSlug: string, given: unknown): Promise<{ ok: true; message: string } | { ok: false; problem: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problem: adminText(await actionAdminLang(), "settings").common.noChange };
  const w = adminText(adminLangOf(member.account.adminLocale), "settings").priceRules;
  const parsed = ruleInput.safeParse(given);
  if (!parsed.success) return { ok: false, problem: w.unreadable };
  const result = await saveMarketPriceRule(member.store, member.account.id, parsed.data);
  if (!result.ok) return { ok: false, problem: priceRuleProblem(member, result.problem) };
  refreshPrices(member.store.id, member.store.slug);
  return { ok: true, message: fillWords(w.saved, { n: result.written }) };
}

/** Takes a country's rule away; its prices stay as they are, now set by hand. */
export async function removePriceRuleAction(storeSlug: string, market: string): Promise<{ ok: true; message: string } | { ok: false; problem: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member || !/^[A-Z]{2}$/.test(market)) return { ok: false, problem: adminText(await actionAdminLang(), "settings").common.noChange };
  await removeMarketPriceRule(member.store, member.account.id, market);
  refreshPrices(member.store.id, member.store.slug);
  return { ok: true, message: adminText(adminLangOf(member.account.adminLocale), "settings").priceRules.removed };
}

/** A rule's problem in the account's language (the catalogue's words for the sentences `ruleProblem()` writes). */
function priceRuleProblem(member: { account: { adminLocale?: string | null } }, problem: string): string {
  return adminText(adminLangOf(member.account.adminLocale), "settings").priceRules.problems[problem] ?? problem;
}
