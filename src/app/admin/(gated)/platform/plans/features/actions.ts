"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { parseMatrixForm } from "@/lib/plan-features";
import { requirePlatformAdmin } from "@/server/auth";
import { getFeatureMatrix, saveFeatureMatrix } from "@/server/plan-features";

/** Saves the plan comparison: every feature's words and order, the new ones, and what each shown plan includes. */
export async function saveFeaturesAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const matrix = await getFeatureMatrix();
  const shown = matrix.plans.filter((plan) => plan.active).map((plan) => plan.id);
  const parsed = parseMatrixForm(formData, { featureIds: matrix.features.map((f) => f.id), planIds: shown });
  if (!parsed.ok) return { status: "error", messages: parsed.problems };
  await saveFeatureMatrix(admin, parsed.input, shown);
  refresh();
  return { status: "ok", messages: ["Saved. Store owners see the comparison when they choose a plan."] };
}
