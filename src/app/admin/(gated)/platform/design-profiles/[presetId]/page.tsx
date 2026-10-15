import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StarterPictureField } from "@/components/admin/starter-picture-field";
import { ThemePicturesField } from "@/components/admin/theme-pictures-field";
import { ThemeChecks } from "@/components/admin/theme-checks";
import { DESIGN_LIMITS, designPreviewPath } from "@/lib/design-presets";
import { deleteBlocker } from "@/lib/lifecycle";
import { themeStoreUrl } from "@/lib/theme-host";
import { STORE_KINDS, THEME_PICTURES_MAX, THEME_STYLES, suggestedSlug } from "@/lib/theme-store";
import { designChecks, shownDesignDetails, snapshotSources } from "@/server/design-presets";
import { listStarters } from "@/server/store-starters";

import { uploadPlatformImageAction } from "../../actions";
import { copyStoreLookAction, saveDesignDraftAction, saveThemeListingAction } from "../actions";
import { designPage } from "./data";
import { DesignShell } from "./shell";

export const metadata: Metadata = { title: "Design profile" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-3 rounded-lg border border-line bg-card p-5";
const KIND_WORDS = { template: "the demo template", starter: "store template", store: "store" } as const;

/**
 * A design profile's details (D176, D177): what stores read on its card and its picture, saved as a draft and published with the profile;
 * where it starts again from a store; and previews on each store template. Its look is edited on the other tabs.
 */
export default async function DesignProfilePage({ params, searchParams }: PageProps<"/admin/platform/design-profiles/[presetId]">) {
  const { admin, design, facts } = await designPage((await params).presetId);
  const [query, starters, sources, checks] = await Promise.all([searchParams, listStarters(), snapshotSources(admin), designChecks(design)]);
  const shown = shownDesignDetails(design);
  const blocker = deleteBlocker("design profile", { stores: design.storesUsing, requests: design.requests });

  return (
    <DesignShell design={design} facts={facts} tab="details">
      {query.made && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          The design profile is made, unpublished. Set its look up on the tabs above, preview the draft, then publish it.
          {query.notes && " Some of the store's look could not be kept: custom fields, menus other than the header's and footer's, or CSS reaching into its files."}
        </p>
      )}

      <section aria-labelledby="publishing" className={card}>
        <h2 id="publishing" className="text-title text-ink">
          Publishing
        </h2>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>
            Everything you change here (details, theme, header, footer, product page, CSS) is the profile&apos;s draft. Stores keep the profile as
            last published until you publish again; stores that applied it keep the look they got.
          </li>
          <li>Unpublish takes it out of the choices at once; access requests that chose it keep the template&apos;s own design unless you choose another.</li>
          <li>Archive hides it everywhere but Archived and stops store templates recommending it; Restore brings it back, unpublished.</li>
          <li>{blocker ?? "Nothing used it yet, so it can be deleted."}</li>
        </ul>
        {!design.workspaceStoreId && (
          <p className="text-sm">Made before profiles were edited here: opening its Theme, Header, Footer, Product page or CSS sets it up for editing from what is published.</p>
        )}
      </section>

      <ThemeChecks result={checks} />

      <ActionForm action={saveDesignDraftAction.bind(null, design.id)} className="flex max-w-3xl flex-col gap-4">
        <h2 className="text-title text-ink">Details</h2>
        <label className={field}>
          Title
          <input name="title" required maxLength={DESIGN_LIMITS.title} defaultValue={shown.title} className={control} />
        </label>
        <label className={field}>
          Summary <span className="font-normal text-muted">(on the card, up to {DESIGN_LIMITS.summary} characters)</span>
          <input name="summary" maxLength={DESIGN_LIMITS.summary} defaultValue={shown.summary} className={control} />
        </label>
        <label className={field}>
          Description <span className="font-normal text-muted">(plain text)</span>
          <textarea name="description" rows={6} maxLength={DESIGN_LIMITS.description} defaultValue={shown.description} className={`${control} py-2`} />
        </label>
        <StarterPictureField initial={shown.pictureUrl} upload={uploadPlatformImageAction} />
        <div>
          <SubmitButton>Save draft</SubmitButton>
        </div>
      </ActionForm>

      <section aria-labelledby="listing" className={card}>
        <div>
          <h2 id="listing" className="text-title text-ink">
            Theme store listing
          </h2>
          <p className="text-sm text-muted">
            Where the theme is found in the theme store, what it is listed under and the pictures its page shows beside the main one. Saved at once, not as a draft: the store shows it while
            the theme is published. What the theme includes is worked out from its published version.
            {design.slug && design.published && (
              <>
                {" "}
                <a href={themeStoreUrl(design.slug)} target="_blank" rel="noopener" className="underline underline-offset-2">
                  Open its page<span className="sr-only"> (opens in a new window)</span>
                </a>
              </>
            )}
          </p>
        </div>
        <ActionForm action={saveThemeListingAction.bind(null, design.id)} className="flex max-w-3xl flex-col gap-4">
          <label className={field}>
            Address <span className="font-normal text-muted">(/themes/…, lowercase letters, digits and hyphens)</span>
            <input name="slug" required maxLength={60} pattern="[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?" defaultValue={design.slug ?? suggestedSlug(shown.title)} className={control} />
          </label>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Suits these kinds of store <span className="font-normal text-muted">(none: any)</span></legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(Object.keys(STORE_KINDS) as (keyof typeof STORE_KINDS)[]).map((kind) => (
                <label key={kind} className="flex items-center gap-2">
                  <input type="checkbox" name="kinds" value={kind} defaultChecked={design.listing.kinds.includes(kind)} className="size-4" />
                  {STORE_KINDS[kind]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Styles</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(Object.keys(THEME_STYLES) as (keyof typeof THEME_STYLES)[]).map((style) => (
                <label key={style} className="flex items-center gap-2">
                  <input type="checkbox" name="styles" value={style} defaultChecked={design.listing.styles.includes(style)} className="size-4" />
                  {THEME_STYLES[style]}
                </label>
              ))}
            </div>
          </fieldset>
          <ThemePicturesField initial={design.listing.pictures} upload={uploadPlatformImageAction} max={THEME_PICTURES_MAX} />
          <div>
            <SubmitButton variant="secondary">Save the listing</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="previews" className="flex flex-col gap-2 text-sm">
        <h2 id="previews" className="text-title text-ink">
          Preview on a store template
        </h2>
        <p className="text-muted">Opens in a new window: the front page and a product of a store template (its store as it is now), drawn with this look. Nothing is changed.</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {[{ id: null as string | null, title: "the Standard store", published: true }, ...starters].map((starter) => (
            <li key={starter.id ?? "standard"} className="flex flex-wrap gap-x-2">
              <span>On {starter.title}{!starter.published && " (not published)"}:</span>
              <a href={designPreviewPath(design.id, starter.id, true)} target="_blank" rel="noopener" className="underline underline-offset-2">
                as published<span className="sr-only"> (opens in a new window)</span>
              </a>
              {design.workspaceStoreId && (
                <a href={designPreviewPath(design.id, starter.id, true, true)} target="_blank" rel="noopener" className="underline underline-offset-2">
                  the draft<span className="sr-only"> (opens in a new window)</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="start-again" className={card}>
        <div>
          <h2 id="start-again" className="text-title text-ink">
            Start again from a store
          </h2>
          <p className="text-sm text-muted">
            Replaces the draft look (theme, header, footer, product page and CSS) with a store&apos;s look as it is now. Its content and brand
            never come along. Stores keep the published profile until you publish.
          </p>
        </div>
        {sources.length === 0 ? (
          <p className="text-sm">You work in no store yet. Open a store template&apos;s admin from Store templates first.</p>
        ) : (
          <ActionForm action={copyStoreLookAction.bind(null, design.id)} className="flex max-w-3xl flex-col gap-3">
            <label className={field}>
              The store
              <select name="store" required className={control}>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} ({KIND_WORDS[source.kind]}, /s/{source.slug})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
              <span>Replace the draft look of {shown.title} with this store&apos;s.</span>
            </label>
            <div>
              <SubmitButton variant="secondary">Replace the draft look</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>
    </DesignShell>
  );
}
