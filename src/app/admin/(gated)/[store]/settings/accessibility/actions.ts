"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { checkOwnerRole, NO_ACCESS } from "@/server/permissions";
import { createStatementDraft, saveA11ySettings } from "@/server/accessibility";

/**
 * The accessibility page (wave 1, 1e, docs/wave-1-trust.md 2.3): what the owner says about the site's assessment, and a draft statement
 * made from it and from what the site itself knows. Owners only; each action asks for itself and the server functions refuse again.
 * "Meets the requirements" is refused without an assessor and a date, here, in the generator and in the database.
 */

const denied: FormState = { status: "error", messages: [NO_ACCESS] };

export async function saveAccessibilityAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied;
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") raw[key] = value;
  const result = await saveA11ySettings(member, raw);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved."] };
}

export async function createStatementAction(storeSlug: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return denied;
  const result = await createStatementDraft(member);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  const others = result.translations.length > 0 ? ` and in ${result.translations.join(", ")}` : "";
  return {
    status: "ok",
    messages: [`A draft statement was made in ${result.language}${others}. It is not published. Open it under Pages, read it, fill in the [[bracketed]] parts, publish it and choose it as the accessibility statement under Legal pages.`],
  };
}
