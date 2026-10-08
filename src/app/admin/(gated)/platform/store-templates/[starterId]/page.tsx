import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LifecycleBadge, LifecycleButtons } from "@/components/admin/lifecycle-buttons";
import { PreviewLink } from "@/components/admin/preview-link";
import { StarterPictureField } from "@/components/admin/starter-picture-field";
import { deleteBlocker } from "@/lib/lifecycle";
import { formatMoney } from "@/lib/money";
import { featureSummary } from "@/lib/onboarding";
import { STARTER_CATEGORIES, STARTER_CATEGORY_LABELS, STARTER_LIMITS } from "@/lib/store-starters";
import { FEATURES_BY_ID, STORE_FEATURES, featureKept, featureOn, featureWarnings } from "@/lib/store-features";
import { requirePlatformAdmin } from "@/server/auth";
import { listDesigns } from "@/server/design-presets";
import { featureFacts } from "@/server/store-features";
import { getStarter, shownDetails, starterLifecycle, starterPreviewHref } from "@/server/store-starters";

import { uploadPlatformImageAction } from "../../actions";
import {
  archiveStarterAction,
  deleteStarterAction,
  openStarterAdminAction,
  publishStarterAction,
  restoreStarterAction,
  saveStarterDraftAction,
  setStarterFeaturesAction,
  unpublishStarterAction,
} from "../actions";

export const metadata: Metadata = { title: "Store template" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";

/**
 * One store template (D175, D177): its details (what owners read on its card, its picture and the design profile it recommends), saved as a
 * draft and published with its store frozen as it is then; and its life: publish, unpublish, archive or restore, delete while unused. What it
 * holds is edited in its own store admin.
 */
export default async function StoreTemplatePage({ params }: PageProps<"/admin/platform/store-templates/[starterId]">) {
  await connection();
  await requirePlatformAdmin();
  const [starter, designs] = await Promise.all([getStarter((await params).starterId), listDesigns()]);
  if (!starter) notFound();
  const shown = shownDetails(starter);
  const facts = starterLifecycle(starter);
  const blocker = deleteBlocker("store template", { stores: starter.storesMade, requests: starter.requests });
  // The recommended profile as saved, even when it was archived since (it is then offered as such, to change).
  const recommended = shown.recommendedDesign ? designs.find((d) => d.id === shown.recommendedDesign) : null;
  // What switching off one of its features would mean (D178 step 6), for the form's tick, as on a store's Features page.
  const counted = await featureFacts(starter.storeId);
  const warnings = STORE_FEATURES.filter((f) => featureOn(starter.features, f.id)).flatMap((f) => {
    const lines = featureWarnings(f.id, counted, starter.features, (minor, currency) => formatMoney(minor, currency, "en"));
    return lines.length > 0 ? [{ label: f.label, lines }] : [];
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/admin/platform/store-templates" className="w-fit text-sm underline underline-offset-2">
          Store templates
        </Link>
        <h1 className="text-2xl font-semibold">
          {shown.title}
          <LifecycleBadge facts={facts} />
        </h1>
        <p className="text-sm text-muted">
          Its store is /s/{starter.storeSlug}
          {starter.publishedAt && ` · last published ${starter.publishedAt.slice(0, 10)}`}
          {starter.publishedSlug && ` · new stores are copied from /s/${starter.publishedSlug}`}
          {` · ${starter.storesMade} ${starter.storesMade === 1 ? "store" : "stores"} made from it`}
        </p>
      </div>

      <section aria-labelledby="state" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="state" className="font-medium">
          Publishing
        </h2>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>Save draft keeps the details here only; owners see the published ones until you publish.</li>
          <li>
            Publish puts the details on the cards and keeps a copy of its store as it is now: new stores are made from that copy, and owners
            preview it. Changes you make in its store after reach no one until you publish again.
          </li>
          <li>Unpublish takes it out of the choices at once; access requests that chose it get the Standard store unless you choose another.</li>
          <li>Archive hides it everywhere but Archived; Restore brings it back, unpublished.</li>
          <li>{blocker ?? "Nothing used it yet, so it can be deleted."}</li>
        </ul>
        {starter.draft && <p className="text-sm">Its details have changes not published yet.</p>}
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
            kind="store template"
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
      </section>

      <section aria-labelledby="features" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="features" className="font-medium">
          Features
        </h2>
        <p className="text-sm text-muted">
          What a store made from this template starts with switched on (its store&apos;s Settings, Features). The owner&apos;s setup asks what
          they will sell with these chosen, and they can change everything after. New stores get them once you publish.
        </p>
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
            <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
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
      </section>

      <ActionForm action={saveStarterDraftAction.bind(null, starter.id)} className="flex max-w-3xl flex-col gap-4">
        <h2 className="font-medium">Details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={field}>
            Title
            <input name="title" required maxLength={STARTER_LIMITS.title} defaultValue={shown.title} className={control} />
          </label>
          <label className={field}>
            Category
            <select name="category" required defaultValue={shown.category} className={control}>
              {STARTER_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {STARTER_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={field}>
          Summary <span className="font-normal text-muted">(on the card, up to {STARTER_LIMITS.summary} characters)</span>
          <input name="summary" maxLength={STARTER_LIMITS.summary} defaultValue={shown.summary} className={control} />
        </label>
        <label className={field}>
          Description <span className="font-normal text-muted">(plain text)</span>
          <textarea name="description" rows={6} maxLength={STARTER_LIMITS.description} defaultValue={shown.description} className={`${control} py-2`} />
        </label>
        <StarterPictureField initial={shown.pictureUrl} upload={uploadPlatformImageAction} />
        <label className={field}>
          Recommended design profile
          <select name="design" defaultValue={shown.recommendedDesign ?? ""} className={control}>
            <option value="">None: the template&apos;s own look</option>
            {designs.map((design) => (
              <option key={design.id} value={design.id}>
                {design.title}
                {!design.published && " (not published)"}
              </option>
            ))}
            {shown.recommendedDesign && !recommended && <option value={shown.recommendedDesign}>A design profile that was archived: choose another</option>}
          </select>
          <span className="font-normal text-muted">
            Chosen first when a store is made from this template (D176), while that profile is published; the person may choose another. To
            change this template&apos;s own look, apply a profile from its page under All stores, or edit it in its admin.
          </span>
        </label>
        <div>
          <SubmitButton>Save draft</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
