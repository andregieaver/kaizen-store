import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ListingWordsFields } from "@/components/admin/listing-words-fields";
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
import { planCurrencies } from "@/server/billing";
import { stuckThemePurchases, themePrices, themePurchaseCounts } from "@/server/theme-prices";

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
import { ThemePriceCard } from "./price-card";
import { DesignShell } from "./shell";
import { fillWords } from "@/lib/admin-fill";
import { platformSiteWords } from "@/server/platform-site-words";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";

export const metadata: Metadata = { title: "Theme" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-3 rounded-lg border border-line bg-card p-5";

/**
 * A theme's details (D176, D177): what stores read on its card and its picture, saved as a draft and published with the theme; its checks,
 * photographs and listing; and where it starts again from a store. Its look is edited on the other tabs, and its own content (D275) on its
 * Content tab.
 */
export default async function ThemePage({ params, searchParams }: PageProps<"/admin/platform/themes/[presetId]">) {
  const { admin, design, facts } = await designPage((await params).presetId);
  const [query, sources, checks, presets, shots, prices, currencies, counts, stuck] = await Promise.all([
    searchParams,
    snapshotSources(admin),
    designChecks(design),
    listVariations(admin, design.id),
    themeShotStatus(design.id),
    themePrices([design.id]),
    planCurrencies(),
    themePurchaseCounts(design.id),
    stuckThemePurchases(design.id),
  ]);
  const { lang, w } = await platformSiteWords();
  const t = w.theme;
  const shown = shownDesignDetails(design);
  const blocker = deleteBlocker("theme", { stores: design.storesUsing, requests: design.requests, platform: design.onPlatform }, w.tables.blocker);

  return (
    <DesignShell design={design} facts={facts} tab="details">
      {query.made && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {t.made}
          {query.notes && t.notKept}
        </p>
      )}
      {query.copied && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {t.copied}
          {query.notes && t.notKept}
        </p>
      )}

      <section aria-labelledby="publishing" className={card}>
        <h2 id="publishing" className="text-title text-ink">
          {t.publishing}
        </h2>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>{t.pubDraft}</li>
          <li>{t.pubUnpublish}</li>
          <li>{t.pubArchive}</li>
          <li>{blocker ?? t.pubDeletable}</li>
        </ul>
        {!design.workspaceStoreId && (
          <p className="text-sm">{t.oldWorkspace}</p>
        )}
      </section>

      <p className="text-sm text-muted">
        {t.contentBefore}
        <Link href={designTabHref(design.id, "content")} className="text-ink underline underline-offset-2">
          {t.contentLink}
        </Link>
        .
      </p>

      <ThemePriceCard
        presetId={design.id}
        title={shown.title}
        prices={prices.get(design.id) ?? []}
        currencies={currencies}
        counts={counts}
        stuck={stuck}
        w={w}
      />

      <ThemeChecks result={checks} words={w.checks} names={w.tables.checks} />

      <ThemeShotsPanel
        looks={[{ key: null, name: shown.title }, ...presets.map((p) => ({ key: p.key, name: p.name }))]}
        shots={shots}
        published={design.published}
        retry={retryThemeShotsAction.bind(null, design.id)}
        own={design.listing.own}
        ownAction={saveThemeOwnPictureAction.bind(null, design.id)}
        upload={uploadPlatformImageAction}
        words={w.shots}
        tables={w.tables}
        locale={ADMIN_LANG_FACTS[lang].locale}
      />

      <ActionForm action={saveDesignDraftAction.bind(null, design.id)} className="flex max-w-3xl flex-col gap-4">
        <h2 className="text-title text-ink">{t.details}</h2>
        <label className={field}>
          {w.themes.fieldTitle}
          <input name="title" required maxLength={DESIGN_LIMITS.title} defaultValue={shown.title} className={control} />
        </label>
        <label className={field}>
          {w.themes.summary} <span className="font-normal text-muted">{fillWords(t.summaryHint, { max: DESIGN_LIMITS.summary })}</span>
          <input name="summary" maxLength={DESIGN_LIMITS.summary} defaultValue={shown.summary} className={control} />
        </label>
        <label className={field}>
          {w.themes.descriptionField} <span className="font-normal text-muted">{t.descriptionHint}</span>
          <textarea name="description" rows={6} maxLength={DESIGN_LIMITS.description} defaultValue={shown.description} className={`${control} py-2`} />
        </label>
        <StarterPictureField initial={shown.pictureUrl} upload={uploadPlatformImageAction} />
        <div>
          <SubmitButton>{t.saveDraft}</SubmitButton>
        </div>
      </ActionForm>

      <section aria-labelledby="listing" className={card}>
        <div>
          <h2 id="listing" className="text-title text-ink">
            {t.listing}
          </h2>
          <p className="text-sm text-muted">
            {t.listingDescription}
            {design.slug && design.published && (
              <>
                {" "}
                <a href={themeStoreUrl(design.slug)} target="_blank" rel="noopener" className="underline underline-offset-2">
                  {t.openPage}
                  <span className="sr-only"> {w.preview.opensNew}</span>
                </a>
              </>
            )}
          </p>
        </div>
        <ActionForm action={saveThemeListingAction.bind(null, design.id)} className="flex max-w-3xl flex-col gap-4">
          <label className={field}>
            {t.address} <span className="font-normal text-muted">{t.addressHint}</span>
            <input name="slug" required maxLength={60} pattern="[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?" defaultValue={design.slug ?? suggestedSlug(shown.title)} className={control} />
          </label>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">
              {t.suits} <span className="font-normal text-muted">{t.suitsHint}</span>
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(Object.keys(STORE_KINDS) as (keyof typeof STORE_KINDS)[]).map((kind) => (
                <label key={kind} className="flex items-center gap-2">
                  <input type="checkbox" name="kinds" value={kind} defaultChecked={design.listing.kinds.includes(kind)} className="size-4" />
                  {w.tables.storeKinds[kind]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">{t.styles}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(Object.keys(THEME_STYLES) as (keyof typeof THEME_STYLES)[]).map((style) => (
                <label key={style} className="flex items-center gap-2">
                  <input type="checkbox" name="styles" value={style} defaultChecked={design.listing.styles.includes(style)} className="size-4" />
                  {w.tables.styles[style]}
                </label>
              ))}
            </div>
          </fieldset>
          <ThemePicturesField initial={design.listing.pictures} upload={uploadPlatformImageAction} max={THEME_PICTURES_MAX} />
          <HighlightWordsFields initial={design.listing.highlights} suggest={suggestHighlightWordsAction.bind(null, design.id)} />
          <ListingWordsFields initial={design.listing.words} words={w.fields} names={w.tables.highlights} />
          <div>
            <SubmitButton variant="secondary">{t.saveListing}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="start-again" className={card}>
        <div>
          <h2 id="start-again" className="text-title text-ink">
            {t.startAgain}
          </h2>
          <p className="text-sm text-muted">{t.startAgainDescription}</p>
        </div>
        {sources.length === 0 ? (
          <p className="text-sm">{t.noStore}</p>
        ) : (
          <ActionForm action={copyStoreLookAction.bind(null, design.id)} className="flex max-w-3xl flex-col gap-3">
            <label className={field}>
              {w.themes.theStore}
              <select name="store" required className={control}>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} ({w.kinds[source.kind]}, /s/{source.slug})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
              <span>{fillWords(t.replaceConfirm, { title: shown.title })}</span>
            </label>
            <div>
              <SubmitButton variant="secondary">{t.replace}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>
    </DesignShell>
  );
}
