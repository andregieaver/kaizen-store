"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { AdminLang } from "@/lib/admin-lang";
import { parseBundleForm, parseExtensionForm, parseFoundingForm, parseGrantsForm, type FormProblem } from "@/lib/extension-form";
import { ALLOWANCES_OF, EXTENSION_IDS, isExtensionId, type ExtensionId } from "@/lib/extensions";
import { listPlans } from "@/server/billing";
import { launchExtensions } from "@/server/extension-launch";
import { extensionCurrencies, getExtensionCatalogue, saveBundle, saveExtension, saveExtensionFounding, savePlanGrants } from "@/server/extensions";
import { platformAction } from "@/server/store-action";

/** The extension catalogue's three forms (D748 step E2), at the platform's plans area, write. */

const words = (lang: AdminLang) => adminText(lang, "platform").extensions;

function said(lang: AdminLang, problems: readonly FormProblem[]): FormState {
  const w = words(lang).problems;
  return { status: "error", messages: problems.map((p) => ("values" in p ? fillWords(w[p.key], p.values) : w[p.key])) };
}

/** Saves one extension: its words, whether it is sold on its own, and its sizes with allowances and prices. */
export async function saveExtensionAction(id: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: "platform.extension_save", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (account, lang) => {
    if (!isExtensionId(id)) return { status: "error", messages: [words(lang).problems.unknownExtension] };
    const catalogue = await getExtensionCatalogue();
    const extension = catalogue.extensions.find((e) => e.id === id);
    if (!extension) return { status: "error", messages: [words(lang).problems.unknownExtension] };
    const parsed = parseExtensionForm(form, {
      sizeIds: extension.sizes.map((s) => s.id),
      allowanceKeys: ALLOWANCES_OF[id],
      currencies: await extensionCurrencies(),
    });
    if (!parsed.ok) return said(lang, parsed.problems);
    const result = await saveExtension(account, id, parsed.input);
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    return { status: "ok", messages: [words(lang).saved] };
  });
}

/** Creates a bundle (`bundleId` null) or saves one. */
export async function saveBundleAction(bundleId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: "platform.extension_bundle_save", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (account, lang) => {
    if (bundleId !== null) {
      const known = z.uuid().safeParse(bundleId).success && (await getExtensionCatalogue()).bundles.some((b) => b.id === bundleId);
      if (!known) return { status: "error", messages: [words(lang).problems.unknownBundle] };
    }
    const parsed = parseBundleForm(form, { currencies: await extensionCurrencies() });
    if (!parsed.ok) return said(lang, parsed.problems);
    const result = await saveBundle(account, bundleId, parsed.input);
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    return { status: "ok", messages: [bundleId ? words(lang).saved : words(lang).created] };
  });
}

/** Saves what each offered plan includes. */
export async function savePlanGrantsAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: "platform.extension_grants_save", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (account, lang) => {
    const [catalogue, plans] = await Promise.all([getExtensionCatalogue(), listPlans()]);
    const planIds = plans.filter((p) => p.active).map((p) => p.id);
    const sizesOf = Object.fromEntries(
      EXTENSION_IDS.map((id) => [id, catalogue.extensions.find((e) => e.id === id)?.sizes.map((s) => s.id) ?? []]),
    ) as Record<ExtensionId, string[]>;
    const parsed = parseGrantsForm(form, { planIds, sizesOf });
    if (!parsed.ok) return said(lang, parsed.problems);
    const result = await savePlanGrants(account, planIds, parsed.input);
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    return { status: "ok", messages: [words(lang).saved] };
  });
}

/** Launches extensions (D748 step E5): every account moved to one plan, the 60-day trials started, extensions sold from now on. */
export async function launchExtensionsAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: "platform.extensions_launch", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (account, lang) => {
    const w = words(lang).launch;
    if (form.get("understand") !== "on") return { status: "error", messages: [w.tick] };
    const result = await launchExtensions(account);
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    const done = fillWords(w.launched, { moved: String(result.moved ?? 0), trials: String(result.trials ?? 0) });
    return { status: "ok", messages: result.note ? [done, fillWords(w.notes, { notes: result.note })] : [done] };
  });
}

/** Saves the founding offer (D748 E6): the last day founding prices are offered (empty: not offered) and how many months one is kept. */
export async function saveFoundingAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "plans", action: "platform.extension_founding_save", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (account, lang) => {
    const parsed = parseFoundingForm(form);
    if (!parsed.ok) return said(lang, parsed.problems);
    await saveExtensionFounding(account, parsed.input.until, parsed.input.months);
    refresh();
    return { status: "ok", messages: [words(lang).saved] };
  });
}
