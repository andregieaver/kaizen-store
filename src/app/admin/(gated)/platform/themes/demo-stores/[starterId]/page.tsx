import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LifecycleBadge, LifecycleButtons } from "@/components/admin/lifecycle-buttons";
import { PreviewLink } from "@/components/admin/preview-link";
import { deleteBlocker } from "@/lib/lifecycle";
import { formatMoney } from "@/lib/money";
import { featureSummary } from "@/lib/onboarding";
import { STARTING_CONTENT_HREF } from "@/lib/theme-admin-paths";
import { FEATURES_BY_ID, STORE_FEATURES, featureKept, featureOn, featureWarnings } from "@/lib/store-features";
import { requirePlatformAdmin } from "@/server/auth";
import { featureFacts } from "@/server/store-features";
import { getDemoStore, presetCheck } from "@/server/demo-stores";
import { getStarter, shownDetails, starterLifecycle, starterPreviewHref } from "@/server/store-starters";
import { Card, PageHeader } from "@/components/admin/ui";

import {
  archiveStarterAction,
  deleteStarterAction,
  openStarterAdminAction,
  publishStarterAction,
  restoreStarterAction,
  setStarterFeaturesAction,
  unpublishStarterAction,
} from "../actions";
import { DemoStoreView } from "./demo-store-view";

export const metadata: Metadata = { title: "Demo store" };

/**
 * One store template (D175, D177, D273): starting content, the content a theme's look starts new stores with, with its life (publish, which
 * freezes its store as it is then; unpublish, archive or restore, delete while unused) and the features a new store starts with switched
 * on; or a live demo store (D277, `DemoStoreView`). What either holds is edited in its own store admin.
 */
export default async function DemoStorePage({ params, searchParams }: PageProps<"/admin/platform/themes/demo-stores/[starterId]">) {
  await connection();
  await requirePlatformAdmin();
  const { starterId } = await params;
  const starter = await getStarter(starterId);
  if (!starter) notFound();
  // A live demo store (D277) has a page of its own: live as it stands, and *Publish this look…*.
  if (starter.kind === "demo") {
    const demo = await getDemoStore(starterId);
    if (!demo) notFound();
    const [query, preset] = await Promise.all([searchParams, presetCheck(demo)]);
    return <DemoStoreView demo={demo} preset={preset.ok ? { ok: true } : preset} unthemed={Boolean(query.unthemed)} />;
  }
  const shown = shownDetails(starter);
  const facts = starterLifecycle(starter);
  const blocker = deleteBlocker("demo store", { stores: starter.storesMade, requests: starter.requests });
  // What switching off one of its features would mean (D178 step 6), for the form's tick, as on a store's Features page.
  const counted = await featureFacts(starter.storeId);
  const warnings = STORE_FEATURES.filter((f) => featureOn(starter.features, f.id)).flatMap((f) => {
    const lines = featureWarnings(f.id, counted, starter.features, (minor, currency) => formatMoney(minor, currency, "en"));
    return lines.length > 0 ? [{ label: f.label, lines }] : [];
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: STARTING_CONTENT_HREF, label: "Themes" }}
        title={shown.title}
        status={<LifecycleBadge facts={facts} />}
        meta={[
          `Its store is /s/${starter.storeSlug}`,
          starter.publishedAt && `Last published ${starter.publishedAt.slice(0, 10)}`,
          starter.publishedSlug && `New stores are copied from /s/${starter.publishedSlug}`,
          `${starter.storesMade} ${starter.storesMade === 1 ? "store" : "stores"} made from it`,
        ]}
      />

      <Card title="Publishing" className="flex flex-col gap-3" compact>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>
            Publish keeps a copy of its store as it is now: new stores that start from a look shown on it are made from that copy, and the
            theme store shows it. Changes you make in its store after reach no one until you publish again.
          </li>
          <li>Unpublish takes it away at once: looks shown on it start new stores from the Standard store, and the theme store shows them there.</li>
          <li>Archive leaves it out of the demo stores; Restore brings it back, unpublished.</li>
          <li>{blocker ?? "Nothing used it yet, so it can be deleted."}</li>
        </ul>
        {starter.changedInStore && <p className="text-sm">Its store changed since it was last published (from its activity log).</p>}
        {starter.published && !starter.publishedSlug && (
          <p className="text-sm">Published before copies were kept: new stores copy its store as it is now. Publish it again to keep a copy.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={openStarterAdminAction.bind(null, starter.id)}>
            <SubmitButton variant="secondary">Open the store&apos;s admin</SubmitButton>
          </ActionForm>
          <PreviewLink href={starterPreviewHref(starter.storeSlug)} label="Preview its store" title={shown.title} />
          {starter.publishedSlug && <PreviewLink href={starterPreviewHref(starter.publishedSlug)} label="Preview as published" title={shown.title} />}
          <LifecycleButtons
            kind="demo store"
            title={shown.title}
            facts={facts}
            actions={{
              publish: publishStarterAction.bind(null, starter.id),
              unpublish: unpublishStarterAction.bind(null, starter.id),
              archive: archiveStarterAction.bind(null, starter.id),
              restore: restoreStarterAction.bind(null, starter.id),
              remove: deleteStarterAction.bind(null, starter.id),
            }}
          />
        </div>
      </Card>

      <Card
        title="Features"
        description={<>What a store made from this demo store starts with switched on (its store&apos;s Settings, Features). The owner&apos;s setup asks what they will sell with these chosen, and they can change everything after. New stores get them once you publish.</>}
        className="flex flex-col gap-3"
        compact
      >
        <p className="text-sm">
          Now: {featureSummary(starter.features)}.
          {starter.publishedFeatures && ` As published: ${featureSummary(starter.publishedFeatures)}.`}
        </p>
        <ActionForm action={setStarterFeaturesAction.bind(null, starter.id)} className="flex max-w-3xl flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Switched on</legend>
            {STORE_FEATURES.map((feature) => (
              <label key={feature.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="features" value={feature.id} defaultChecked={featureKept(starter.features, feature.id)} className="mt-1" />
                <span className="flex flex-col">
                  <span className="font-medium">{feature.label}</span>
                  <span className="text-muted">
                    {feature.words}
                    {feature.needs.length > 0 && ` Needs ${feature.needs.map((need) => FEATURES_BY_ID[need].label).join(" and ")}.`}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {warnings.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
              <p className="font-medium">If you switch off something that is on now:</p>
              <ul className="list-disc pl-5">
                {warnings.map((warning) => (
                  <li key={warning.label}>
                    {warning.label}: {warning.lines.join(" ")}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="confirm" className="mt-1" />
                <span>Switch off what I left out.</span>
              </label>
            </div>
          )}
          <div>
            <SubmitButton>Save features</SubmitButton>
          </div>
        </ActionForm>
      </Card>

    </div>
  );
}
