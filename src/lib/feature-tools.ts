/**
 * The AI manager's store feature tools (D178 step 6, `docs/store-features.md` 4f), pure: their arguments and the approval's words, written in
 * code from the feature registry (`STORE_FEATURES`), never by the model. `list_features` reads; `set_feature` is kept for the owner's yes
 * (`public`: it changes what the site offers), and when switching off has warnings the yes is the confirmation the Features page asks for, so
 * the warnings are part of what the owner approves (`approved_warnings`, written by the store, never the model) and the switch is refused when
 * they have changed since.
 */
import { z } from "zod";

import { FEATURE_IDS, FEATURES_BY_ID, isFeatureId, type FeatureId } from "./store-features";

export const listFeaturesInput = z.object({});

export const setFeatureInput = z.object({
  feature: z.enum(FEATURE_IDS).describe(`The feature's id, as list_features gives it: ${FEATURE_IDS.join(", ")}.`),
  on: z.boolean().describe("true to switch it on, false to switch it off."),
  approved_warnings: z
    .array(z.string().max(1000))
    .max(30)
    .optional()
    .describe("Never set this: the store writes it when the owner is asked, so what is switched off is what the owner was told."),
});
export type SetFeatureInput = z.output<typeof setFeatureInput>;

/** What a feature switch will do, in words from the registry and the store's own warnings, for the approval the owner says yes or no to. */
export function featureSwitchSummary(id: FeatureId, on: boolean, warnings: readonly string[] = []): string {
  const feature = FEATURES_BY_ID[id];
  if (on) return `Switch on ${feature.label} under Settings, Features. ${feature.words}`;
  const also = warnings.length > 0 ? ` Also: ${warnings.join(" ")}` : "";
  return `Switch off ${feature.label} under Settings, Features. ${feature.offWords}${also}`;
}

/** The approval's words from the call's arguments alone (the store adds its warnings when it keeps the call). */
export function featureSwitchSummaryOf(input: Record<string, unknown>): string {
  const id = input.feature;
  if (!isFeatureId(id)) return "Switch a store feature.";
  const warnings = Array.isArray(input.approved_warnings) ? input.approved_warnings.map(String) : [];
  return featureSwitchSummary(id, input.on !== false, warnings);
}

/** Whether the warnings the owner approved are the ones switching off means now (the same lines, in any order). */
export function sameWarnings(approved: readonly string[], now: readonly string[]): boolean {
  const a = [...approved].sort();
  const b = [...now].sort();
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
