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
import { countWords, fillWords } from "@/lib/admin-fill";
import { platformSiteWords } from "@/server/platform-site-words";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Demo store" };

/**
 * One store template (D175, D177, D273): starting content, the content a theme's look starts new stores with, with its life (publish, which
 * freezes its store as it is then; unpublish, archive or restore, delete while unused) and the features a new store starts with switched
 * on; or a live demo store (D277, `DemoStoreView`). What either holds is edited in its own store admin.
 */
export default async function DemoStorePage({ params, searchParams }: PageProps<"/admin/platform/themes/demo-stores/[starterId]">) {
  await connection();
  await requirePlatformAdmin();
  const { lang, w } = await platformSiteWords();
  const labels = adminText(lang, "common").features.labels;
  const t = w.starter;
  const { starterId } = await params;
  const starter = await getStarter(starterId);
  if (!starter) notFound();
  // A live demo store (D277) has a page of its own: live as it stands, and *Publish this look…*.
  if (starter.kind === "demo") {
    const demo = await getDemoStore(starterId);
    if (!demo) notFound();
    const [query, preset] = await Promise.all([searchParams, presetCheck(demo)]);
    return <DemoStoreView demo={demo} preset={preset.ok ? { ok: true } : preset} unthemed={Boolean(query.unthemed)} w={w} />;
  }
  const shown = shownDetails(starter);
  const facts = starterLifecycle(starter);
  const blocker = deleteBlocker("demo store", { stores: starter.storesMade, requests: starter.requests }, w.tables.blocker);
  // What switching off one of its features would mean (D178 step 6), for the form's tick, as on a store's Features page.
  const counted = await featureFacts(starter.storeId);
  const warnings = STORE_FEATURES.filter((f) => featureOn(starter.features, f.id)).flatMap((f) => {
    const lines = featureWarnings(f.id, counted, starter.features, (minor, currency) => formatMoney(minor, currency, "en"));
    return lines.length > 0 ? [{ label: f.label, lines }] : [];
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: STARTING_CONTENT_HREF, label: t.back }}
        title={shown.title}
        status={<LifecycleBadge facts={facts} words={w.lifecycle} />}
        meta={[
          fillWords(t.itsStore, { slug: starter.storeSlug }),
          starter.publishedAt && fillWords(t.lastPublished, { date: starter.publishedAt.slice(0, 10) }),
          starter.publishedSlug && fillWords(t.copiedFrom, { slug: starter.publishedSlug }),
          countWords(starter.storesMade, t.made),
        ]}
      />

      <Card title={t.publishing} className="flex flex-col gap-3" compact>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>{t.pubCopy}</li>
          <li>{t.pubUnpublish}</li>
          <li>{t.pubArchive}</li>
          <li>{blocker ?? t.pubDeletable}</li>
        </ul>
        {starter.changedInStore && <p className="text-sm">{t.changedInStore}</p>}
        {starter.published && !starter.publishedSlug && (
          <p className="text-sm">{t.noCopy}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={openStarterAdminAction.bind(null, starter.id)}>
            <SubmitButton variant="secondary">{t.openAdmin}</SubmitButton>
          </ActionForm>
          <PreviewLink href={starterPreviewHref(starter.storeSlug)} label={w.preview.itsStore} title={shown.title} of={w.preview.of} />
          {starter.publishedSlug && <PreviewLink href={starterPreviewHref(starter.publishedSlug)} label={w.preview.asPublished} title={shown.title} of={w.preview.of} />}
          <LifecycleButtons
            kind="demo store"
            title={shown.title}
            facts={facts}
            words={w.lifecycle}
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
        title={t.features}
        description={t.featuresDescription}
        className="flex flex-col gap-3"
        compact
      >
        <p className="text-sm">
          {fillWords(t.now, { summary: featureSummary(starter.features, w.tables.summary, labels) })}
          {starter.publishedFeatures && fillWords(t.asPublished, { summary: featureSummary(starter.publishedFeatures, w.tables.summary, labels) })}
        </p>
        <ActionForm action={setStarterFeaturesAction.bind(null, starter.id)} className="flex max-w-3xl flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t.switchedOn}</legend>
            {STORE_FEATURES.map((feature) => (
              <label key={feature.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="features" value={feature.id} defaultChecked={featureKept(starter.features, feature.id)} className="mt-1" />
                <span className="flex flex-col">
                  <span className="font-medium">{feature.label}</span>
                  <span className="text-muted">
                    {feature.words}
                    {feature.needs.length > 0 && fillWords(t.needs, { features: feature.needs.map((need) => FEATURES_BY_ID[need].label).join(t.and) })}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {warnings.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
              <p className="font-medium">{t.ifOff}</p>
              <ul className="list-disc pl-5">
                {warnings.map((warning) => (
                  <li key={warning.label}>
                    {warning.label}: {warning.lines.join(" ")}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="confirm" className="mt-1" />
                <span>{t.switchOff}</span>
              </label>
            </div>
          )}
          <div>
            <SubmitButton>{t.save}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

    </div>
  );
}
