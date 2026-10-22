import type { ReactElement } from "react";

import { can, type PermissionHolder } from "@/lib/permissions";
import {
  FEATURES_BY_ID,
  featureKept,
  featureOn,
  requirementMet,
  type FeatureId,
  type FeatureRequirement,
  type FeatureSource,
} from "@/lib/store-features";

import { FeatureOffLine, FeatureOffPanel } from "./feature-off-text";

type Props = {
  storeSlug: string;
  /** The feature (or features, any of which would do) the page stands behind. */
  feature: FeatureRequirement;
  /** The store's features as kept: says whether the feature itself is off or only asleep because the shop (or another need) is. */
  features: FeatureSource;
  /** Owners get a link to switch it on; others are told who can. */
  owner: boolean;
};

/**
 * What an admin page behind a store feature (D178) shows while the feature is off, in place of the page: what is off, and for an owner the
 * way to the Features page. Nothing is gone: switching it on brings the page back as it was.
 */
export function FeatureOff({ storeSlug, feature, features, owner }: Props) {
  const ids: readonly FeatureId[] = typeof feature === "string" ? [feature] : feature;
  // Kept on, but asleep: what it needs is off (the shop, or the bonus program for referrals).
  const asleep = ids.find((id) => featureKept(features, id) && !featureOn(features, id));
  const need = asleep ? FEATURES_BY_ID[asleep].needs.find((n) => !featureOn(features, n)) : undefined;
  return <FeatureOffPanel storeSlug={storeSlug} feature={feature} asleep={asleep} need={need} owner={owner} />;
}

/**
 * The gate of an admin page behind a store feature (D178): null while the feature is on, else the `FeatureOff` notice the page returns in
 * place of itself. Called after the page's permission check, with its membership:
 * `const off = requireFeature(current, "subscriptions"); if (off) return off;`
 */
export function requireFeature(member: { store: { slug: string; features: readonly string[] } } & PermissionHolder, feature: FeatureRequirement): ReactElement | null {
  if (requirementMet(member.store, feature)) return null;
  return <FeatureOff storeSlug={member.store.slug} feature={feature} features={member.store} owner={can(member, "owner")} />;
}

/**
 * A feature's part of another admin page while the feature is off (D178): one line in place of the part, saying what is off and, for an
 * owner, linking to Features. Nothing is deleted: switching it on brings the part back as it was.
 */
export function FeatureOffNote({ storeSlug, feature, owner, what }: { storeSlug: string; feature: FeatureRequirement; owner: boolean; what?: string }) {
  return <FeatureOffLine storeSlug={storeSlug} feature={feature} owner={owner} what={what} />;
}
