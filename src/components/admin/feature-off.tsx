import Link from "next/link";
import type { ReactElement } from "react";

import { can, type PermissionHolder } from "@/lib/permissions";
import {
  FEATURES_BY_ID,
  featureKept,
  featureOn,
  requirementLabel,
  requirementMet,
  type FeatureId,
  type FeatureRequirement,
  type FeatureSource,
} from "@/lib/store-features";

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
  const label = requirementLabel(feature);
  // Kept on, but asleep: what it needs is off (the shop, or the bonus program for referrals).
  const asleep = ids.find((id) => featureKept(features, id) && !featureOn(features, id));
  const need = asleep ? FEATURES_BY_ID[asleep].needs.find((n) => !featureOn(features, n)) : undefined;
  const href = `/admin/${storeSlug}/settings/features`;
  return (
    <section aria-labelledby="feature-off-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <h1 id="feature-off-heading" className="text-xl font-semibold">
        {label} {ids.length > 1 ? "are" : "is"} switched off
      </h1>
      <p className="text-sm text-muted">
        {need
          ? `${FEATURES_BY_ID[asleep!].label} needs ${need === "shop" ? "the online shop" : `the ${FEATURES_BY_ID[need].label.toLowerCase()}`}, which is switched off.`
          : "This page is hidden while the feature is off. Nothing has been deleted: switch it on and everything is as it was."}
      </p>
      {owner ? (
        <p>
          <Link href={href} className="inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background">
            Go to Features
          </Link>
        </p>
      ) : (
        <p className="text-sm">Only an owner can switch features on or off, under Settings → Features.</p>
      )}
    </section>
  );
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
