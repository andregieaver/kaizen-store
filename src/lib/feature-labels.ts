import { countWords } from "./admin-fill";
import { commonEn, type CommonMessages } from "./admin-messages/common.en";
import type { FeatureId, FeatureRequirement } from "./store-features";

/** The words for a requirement: "Appointments or Stays and rentals". */
export function requirementLabel(requirement: FeatureRequirement, c: CommonMessages["features"] = commonEn.features): string {
  const ids: readonly FeatureId[] = typeof requirement === "string" ? [requirement] : requirement;
  return ids.map((id) => c.labels[id]).join(c.or);
}

/** What a server action says when a stale page asks for something of a feature that is off: "Appointments is switched off under …". */
export function featureOffText(requirement: FeatureRequirement, c: CommonMessages["features"] = commonEn.features): string {
  const ids: readonly FeatureId[] = typeof requirement === "string" ? [requirement] : requirement;
  return countWords(ids.length, c.offUnder, { label: requirementLabel(requirement, c) });
}

/** A feature that another needs, in a sentence: "the online shop", "the bonus program". */
export const needWords = (id: FeatureId, c: CommonMessages["features"] = commonEn.features): string => c.need[id];
