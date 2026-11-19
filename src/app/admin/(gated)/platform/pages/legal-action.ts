"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { PLATFORM_LEGAL_KINDS, type PlatformLegalKind } from "@/lib/platform-legal";
import { requirePlatform } from "@/server/auth";
import { pagesTag } from "@/server/pages";
import { writePlatformLegalPages } from "@/server/platform-legal";
import { officerFields, readOfficerChoice } from "@/lib/privacy-officer";
import { platformAccountId, setOfficer } from "@/server/privacy-officers";
import { platformAction } from "@/server/store-action";

/** Writes and publishes Kaizena Flow's legal pages in English and Norwegian (D312 P5); a ticked page already written is written again. */
export async function writeLegalPagesAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatform("website");
  const w = adminText(adminLangOf(admin.adminLocale), "platformLegal");
  const overwrite = formData
    .getAll("overwrite")
    .filter((value): value is PlatformLegalKind => (PLATFORM_LEGAL_KINDS as readonly unknown[]).includes(value));
  const outcomes = await writePlatformLegalPages(admin, { overwrite });
  for (const owner of new Set(outcomes.filter((o) => o.outcome === "made" || o.outcome === "written").map((o) => o.owner))) updateTag(pagesTag(owner));
  const list = outcomes.map((o) => `${w.kinds[o.kind]} ${w.outcomes[o.outcome]}`).join(", ");
  const problems = outcomes.flatMap((o) => o.problems ?? []);
  return problems.length > 0
    ? { status: "error", messages: [w.done.replace("{list}", list), ...problems] }
    : { status: "ok", messages: [w.done.replace("{list}", list)] };
}

/** Kaizena Flow's own data protection officer (D763): the platform account's, named on its privacy notice when it is written again. */
export async function setPlatformOfficerAction(_state: FormState, formData: FormData): Promise<FormState> {
  return platformAction({ area: "website", action: "privacy.officer", answer: (message) => ({ status: "error", messages: [message] }) }, async (admin, lang) => {
    const w = adminText(lang, "privacyOfficer");
    const platform = await platformAccountId();
    if (!platform) return { status: "error", messages: [w.notOwner] };
    const read = readOfficerChoice(officerFields(formData), { store: false });
    if (!read.ok) return { status: "error", messages: read.problems };
    const result = await setOfficer(admin.id, platform, null, read.choice);
    if (!result.ok) return { status: "error", messages: result.problems };
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}
