"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { PLATFORM_LEGAL_KINDS, type PlatformLegalKind } from "@/lib/platform-legal";
import { requirePlatformAdmin } from "@/server/auth";
import { PAGES_TAG } from "@/server/pages";
import { writePlatformLegalPages } from "@/server/platform-legal";

/** Writes and publishes Kaizena Flow's legal pages in English and Norwegian (D312 P5); a ticked page already written is written again. */
export async function writeLegalPagesAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platformLegal");
  const overwrite = formData
    .getAll("overwrite")
    .filter((value): value is PlatformLegalKind => (PLATFORM_LEGAL_KINDS as readonly unknown[]).includes(value));
  const outcomes = await writePlatformLegalPages(admin, { overwrite });
  if (outcomes.some((o) => o.outcome === "made" || o.outcome === "written")) updateTag(PAGES_TAG);
  const list = outcomes.map((o) => `${w.kinds[o.kind]} ${w.outcomes[o.outcome]}`).join(", ");
  const problems = outcomes.flatMap((o) => o.problems ?? []);
  return problems.length > 0
    ? { status: "error", messages: [w.done.replace("{list}", list), ...problems] }
    : { status: "ok", messages: [w.done.replace("{list}", list)] };
}
