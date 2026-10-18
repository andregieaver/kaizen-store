import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { HighlightWordsFields } from "@/components/admin/highlight-words-fields";
import { StarterPictureField } from "@/components/admin/starter-picture-field";
import { ThemePicturesField } from "@/components/admin/theme-pictures-field";
import { ThemeChecks } from "@/components/admin/theme-checks";
import { ThemeShotsPanel } from "@/components/admin/theme-shots-panel";
import { DESIGN_LIMITS, designTabHref } from "@/lib/design-presets";
import { deleteBlocker } from "@/lib/lifecycle";
import { themeStoreUrl } from "@/lib/theme-host";
import { STORE_KINDS, THEME_PICTURES_MAX, THEME_STYLES, suggestedSlug } from "@/lib/theme-store";
import { designChecks, shownDesignDetails, snapshotSources } from "@/server/design-presets";
import { listVariations } from "@/server/design-variations";
import { themeShotStatus } from "@/server/theme-shots";

import { uploadPlatformImageAction } from "../../actions";
import {
  copyStoreLookAction,
  retryThemeShotsAction,
  saveDesignDraftAction,
  saveThemeListingAction,
  saveThemeOwnPictureAction,
  suggestHighlightWordsAction,
} from "../actions";
import { designPage } from "./data";
import { DesignShell } from "./shell";

export const metadata: Metadata = { title: "Theme" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-3 rounded-lg border border-line bg-card p-5";
const KIND_WORDS = { template: "the Standard store", starter: "demo store", store: "store" } as const;

/**
 * A theme's details (D176, D177): what stores read on its card and its picture, saved as a draft and published with the theme; its checks,
 * photographs and listing; and where it starts again from a store. Its look is edited on the other tabs, and its own content (D275) on its
 * Content tab.
 */
export default async function ThemePage({ params, searchParams }: PageProps<"/admin/platform/themes/[presetId]">) {
  const { admin, design, facts } = await designPage((await params).presetId);
  const [query, sources, checks, presets, shots] = await Promise.all([
    searchParams,
    snapshotSources(admin),
    designChecks(design),
    listVariations(admin, design.id),
    themeShotStatus(design.id),
  ]);
  const shown = shownDesignDetails(design);
  const blocker = deleteBlocker("theme", { stores: design.storesUsing, requests: design.requests, platform: design.onPlatform });

  return (
    <DesignShell design={design} facts={facts} tab="details">
      {query.made && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          The theme is made, unpublished. Set its look up on the tabs above, preview the draft, then publish it.
          {query.notes && " Some of the store's look could not be kept: custom fields, menus other than the header's and footer's, or CSS reaching into its files."}
        </p>
      )}

      <section aria-labelledby="publishing" className={card}>
        <h2 id="publishing" className="text-title text-ink">
          Publishing
        </h2>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>
            Everything you change here (details, theme settings, presets, header, footer, product page, CSS) is the theme&apos;s draft. Stores
            keep the theme as last published until you publish again; stores that applied it keep the look they got.
          </li>
          <li>Unpublish takes it out of the choices at once; access requests that chose it get the Standard store&apos;s look unless you choose another.</li>
          <li>Archive hides it everywhere but Archived; Restore brings it back, unpublished.</li>
          <li>{blocker ?? "Nothing used it yet, so it can be deleted."}</li>
        </ul>
        {!design.workspaceStoreId && (
          <p className="text-sm">Made before themes were edited here: opening its Theme, Header, Footer, Product page or CSS sets it up for editing from what is published.</p>
        )}
      </section>

      <p className="text-sm text-muted">
        What the theme store shows it with and new stores started from it begin with is its own content:{" "}
        <Link href={designTabHref(design.id, "content")} className="text-ink underline underline-offset-2">
          its Content tab
        </Link>
        .
      </p>

      <ThemeChecks result={checks} />

      <ThemeShotsPanel
        looks={[{ key: null, name: shown.title }, ...presets.map((p) => ({ key: p.key, name: p.name }))]}
        shots={shots}
        published={design.published}
        retry={retryThemeShotsAction.bind(null, design.id)}
        own={design.listing.own}
        ownAction={saveThemeOwnPictureAction.bind(null, design.id)}
        upload={uploadPlatformImageAction}
      />

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
          <HighlightWordsFields initial={design.listing.highlights} suggest={suggestHighlightWordsAction.bind(null, design.id)} />
          <div>
            <SubmitButton variant="secondary">Save the listing</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="start-again" className={card}>
        <div>
          <h2 id="start-again" className="text-title text-ink">
            Start again from a store
          </h2>
          <p className="text-sm text-muted">
            Replaces the draft look (theme, header, footer, product page and CSS) with a store&apos;s look as it is now. Its content and brand
            never come along. Stores keep the published theme until you publish.
          </p>
        </div>
        {sources.length === 0 ? (
          <p className="text-sm">You work in no store yet. Open a demo store&apos;s admin from Demo stores on the Themes page first.</p>
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
