"use client";

import Link from "next/link";

import { countWords, fillWords } from "@/lib/admin-fill";
import { needWords, requirementLabel, type FeatureId, type FeatureRequirement } from "@/lib/store-features";

import { useAdminText } from "./admin-text";

/**
 * The words of `FeatureOff` and `FeatureOffNote` (D312 A8), in the account's language from `common.features`, which the signed-in layout hands
 * every page: the notices are drawn in about a hundred places, each by a server page that has no words of its own for them.
 */
export function FeatureOffPanel({
  storeSlug,
  feature,
  asleep,
  need,
  owner,
}: {
  storeSlug: string;
  feature: FeatureRequirement;
  /** A feature kept on but asleep, and the need of it that is off. */
  asleep?: FeatureId;
  need?: FeatureId;
  owner: boolean;
}) {
  const w = useAdminText("common").features;
  const ids: readonly FeatureId[] = typeof feature === "string" ? [feature] : feature;
  const label = requirementLabel(feature, w);
  return (
    <section aria-labelledby="feature-off-heading" className="flex flex-col gap-3 rounded-panel bg-sunken p-5">
      <h1 id="feature-off-heading" className="text-xl font-medium">
        {countWords(ids.length, w.off, { label })}
      </h1>
      <p className="text-sm text-muted">{asleep && need ? fillWords(w.asleep, { label: w.labels[asleep], need: needWords(need, w) }) : w.hidden}</p>
      {owner ? (
        <p>
          <Link href={`/admin/${storeSlug}/settings/features`} className="inline-flex min-h-11 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
            {w.goTo}
          </Link>
        </p>
      ) : (
        <p className="text-sm">{w.onlyOwner}</p>
      )}
    </section>
  );
}

/** One line in place of a feature's part of another page. */
export function FeatureOffLine({ storeSlug, feature, owner, what }: { storeSlug: string; feature: FeatureRequirement; owner: boolean; what?: string }) {
  const w = useAdminText("common").features;
  return (
    <p className="text-sm text-muted">
      {what ? `${what}: ` : ""}
      {fillWords(w.noteOff, { label: requirementLabel(feature, w) })}{" "}
      {owner ? (
        <Link href={`/admin/${storeSlug}/settings/features`} className="underline">
          {w.noteSwitch}
        </Link>
      ) : (
        w.noteOwner
      )}
      .
    </p>
  );
}
