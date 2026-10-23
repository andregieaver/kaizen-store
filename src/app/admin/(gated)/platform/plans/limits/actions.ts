"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { parseLimitsForm } from "@/lib/limits";
import { requirePlatformAdmin } from "@/server/auth";
import { limitGrid, savePlanLimits } from "@/server/limits-admin";
import { PLANS_TAG } from "@/server/public-plans";

/** Saves the plans' limits and the default (D314, `docs/capacity.md` step 2.6): only the cells that changed are written. */
export async function savePlanLimitsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "capacity");
  const grid = await limitGrid();
  const { cells, problems } = parseLimitsForm(formData, grid.plans.map((p) => p.id));
  if (problems.length > 0) return { status: "error", messages: problems.map((key) => fillWords(w.editor.invalid, { limit: w.limits[key] })) };
  await savePlanLimits(admin, cells);
  // Plan cards on Kaizena Flow's pages show the limits.
  updateTag(PLANS_TAG);
  refresh();
  return { status: "ok", messages: [w.editor.saved] };
}
