"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { isLegalRole } from "@/lib/legal-roles";
import { isStarterRole } from "@/lib/legal-starters";
import { createLegalStarter, setLegalRole, setTermsMode } from "@/server/legal-starters";
import { checkOwnerRole, NO_ACCESS } from "@/server/permissions";

/**
 * The legal pages screen (wave 1, 1e, docs/wave-1-trust.md 2.1, 2.4): make a starter draft, choose the published page for a role, and say what
 * checkout shows about the terms. Owners only: each action asks for itself (`checkOwnerRole`) and the server functions hold the rule again.
 * A starter is only ever a draft; choosing a page is refused until it is published.
 */

const denied: FormState = { status: "error", messages: [NO_ACCESS] };
const refused = (problems: readonly string[]): FormState => ({ status: "error", messages: [...problems] });

/** Makes a draft starter of one kind from the store's own details, in its main language and the others among nb, sv, da and en. */
export async function createStarterAction(storeSlug: string, kind: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied;
  if (!isStarterRole(kind)) return refused(["That kind of page has no starter."]);
  const result = await createLegalStarter(member, kind);
  if (!result.ok) return refused(result.problems);
  refresh();
  const others = result.translations.length > 0 ? ` and written in ${result.translations.join(", ")} as well` : "";
  const notice = result.translatedNotice ? " Your main language is not one of Norwegian, Swedish, Danish or English, so it is in English: have it translated and reviewed." : "";
  return {
    status: "ok",
    messages: [`A draft was made in ${result.language}${others}. It is not published. Open it under Pages, read every sentence, fill in the [[bracketed]] parts and remove the notice, then publish it and choose it here.${notice}`],
  };
}

/** Chooses one of the store's published pages for a legal role, or none. */
export async function setLegalRoleAction(storeSlug: string, role: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied;
  if (!isLegalRole(role)) return refused(["That is not a legal page."]);
  const chosen = String(formData.get("page") ?? "");
  if (chosen !== "" && !z.uuid().safeParse(chosen).success) return refused(["Choose one of your published pages."]);
  const result = await setLegalRole(member, role, chosen === "" ? null : chosen);
  if (!result.ok) return refused(result.problems);
  refresh();
  return { status: "ok", messages: [chosen === "" ? "No page is chosen now." : "Page chosen."] };
}

/** What checkout shows about the terms: a link, a tick box or nothing. */
export async function setTermsModeAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied;
  const result = await setTermsMode(member, String(formData.get("mode") ?? ""));
  if (!result.ok) return refused(result.problems);
  refresh();
  return { status: "ok", messages: ["Saved."] };
}
