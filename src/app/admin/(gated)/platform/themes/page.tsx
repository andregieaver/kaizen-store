import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LifecycleBadge, LifecycleButtons } from "@/components/admin/lifecycle-buttons";
import { PreviewLink } from "@/components/admin/preview-link";
import { DESIGN_LIMITS, designPreviewPath, designTabHref, type DesignRow } from "@/lib/design-presets";
import { listFilterOf, type LifecycleFacts } from "@/lib/lifecycle";
import { requirePlatformAdmin } from "@/server/auth";
import { designLifecycle, listDesigns, shownDesignDetails, snapshotSources } from "@/server/design-presets";
import { launchThemeStates } from "@/server/launch-themes";
import { contentPackStates } from "@/server/content-packs";
import { contentOwners, contentSources, listStarters } from "@/server/store-starters";
import { listDemoStores } from "@/server/demo-stores";
import { themeStorePageStates } from "@/server/platform-roles";
import { lookOf, themeShotsFor } from "@/server/theme-shots";
import { ButtonLink, Card, PageHeader } from "@/components/admin/ui";
import { waitingSubmissions } from "@/server/theme-submissions";
import { THEMES_ADMIN } from "@/lib/theme-admin-paths";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";
import { adminTexts } from "@/lib/admin-text";
import { platformSiteWords } from "@/server/platform-site-words";

import {
  archiveDesignAction,
  createDesignAction,
  deleteDesignAction,
  moveDesignAction,
  publishDesignAction,
  unarchiveDesignAction,
  syncLaunchThemesAction,
  unpublishDesignAction,
} from "./actions";
import { DemoStoresCard } from "./demo-stores/demo-stores-card";
import { LiveDemoStoresCard } from "./demo-stores/live-demo-stores-card";
import { ThemeStorePagesCard } from "./theme-store-pages-card";

export const metadata: Metadata = { title: "Themes" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const tab = "flex min-h-10 items-center rounded-md border border-edge px-3 text-sm hover:bg-sunken aria-[current=page]:bg-sunken aria-[current=page]:font-medium";

/**
 * Themes (D176, D177, D273, `docs/themes-unified.md`): a look (theme, header, footer, product layout and CSS) with its presets, which any
 * store can apply from its design settings and people creating a store start from, each look with the demo store it is shown on and a new
 * store is copied from. Made from a store or from scratch and edited on the theme's own pages; archived ones are listed only under Archived.
 * The demo stores are set up here too, and the theme store's own pages are built from here (D285).
 */
export default async function ThemesPage({ searchParams }: PageProps<"/admin/platform/themes">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const { lang, w } = await platformSiteWords();
  const t = w.themes;
  const query = await searchParams;
  const filter = listFilterOf(query.show);
  const current = filter === "current";
  const [designs, sources, launch, packs, starters, owners, contents, demos, storePages, waiting] = await Promise.all([
    listDesigns(filter),
    snapshotSources(admin),
    launchThemeStates(),
    current ? contentPackStates() : Promise.resolve([]),
    current ? listStarters() : Promise.resolve([]),
    current ? contentOwners() : Promise.resolve(new Map<string, string>()),
    current ? contentSources() : Promise.resolve([]),
    current ? listDemoStores() : Promise.resolve([]),
    current ? themeStorePageStates() : Promise.resolve([]),
    // Themes from outside (D344): looks stores shared, waiting for a review.
    current ? waitingSubmissions(admin) : Promise.resolve(0),
  ]);
  const [facts, shots] = await Promise.all([
    Promise.all(designs.map((design) => designLifecycle(design))),
    // A theme without a picture of its own shows its photograph on its own content (D264), as the theme store's cards do.
    themeShotsFor(designs.map((design) => design.id)),
  ]);
  const published = designs.filter((d) => d.published).length;
  // Which theme each starting content is the own content of (D275), for its row; older demo stores are those no content pack made.
  const contentOf: Record<string, string> = {};
  for (const pack of packs) if (pack.starterId && owners.has(pack.starterId)) contentOf[pack.key] = owners.get(pack.starterId)!;
  const packStores = new Set(packs.map((pack) => pack.starterId));
  const older = starters.filter((starter) => !packStores.has(starter.id));

  return (
    <AdminTextScope texts={adminTexts(lang, ["platformSite"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={t.title} description={t.description} />

      <nav aria-label={t.which} className="flex flex-wrap gap-2">
        <Link href={THEMES_ADMIN} aria-current={current ? "page" : undefined} className={tab}>
          {t.tabThemes}
        </Link>
        <Link href={`${THEMES_ADMIN}?show=archived`} aria-current={filter === "archived" ? "page" : undefined} className={tab}>
          {t.tabArchived}
        </Link>
      </nav>

      {query.deleted && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {query.deleted === "demo"
            ? t.deletedDemo
            : query.deleted === "store-page"
              ? t.deletedStorePage
              : query.deleted === "content"
                ? t.deletedContent
                : t.deletedTheme}
        </p>
      )}

      {current && (
        <Card title={w.submissions.card} description={w.submissions.cardHint} compact>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={`${THEMES_ADMIN}/submissions`}>{w.submissions.title}</ButtonLink>
            {waiting > 0 && <span className="text-sm text-ink-2">{countWords(waiting, w.submissions.waiting, { n: waiting })}</span>}
          </div>
        </Card>
      )}

      <p className="text-sm text-muted">
        {filter === "archived"
          ? designs.length === 0
            ? t.noneArchived
            : countWords(designs.length, t.archivedCount)
          : designs.length === 0
            ? t.none
            : countWords(designs.length, t.count, { published })}
      </p>

      {designs.length > 0 && (
        <ol className="flex flex-col gap-3">
          {designs.map((design, index) => (
            <DesignItem
              key={design.id}
              design={design}
              facts={facts[index]}
              madeCard={shots.get(lookOf(design.id, null))?.computer?.card?.url ?? null}
              first={index === 0}
              last={index === designs.length - 1}
              archived={filter === "archived"}
              w={w}
            />
          ))}
        </ol>
      )}

      {current && <ThemeStorePagesCard states={storePages} w={w} />}

      {current && <LiveDemoStoresCard demos={demos} w={w} />}

      {current && <DemoStoresCard packs={packs} older={older} contentOf={contentOf} w={w} />}

      {current && (
        <Card
          title={t.launchTitle}
          description={t.launchDescription}
          aside={
            <div className="flex flex-wrap items-center gap-3">
              <a href="/themes" target="_blank" rel="noopener" className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm underline underline-offset-2">
                {t.openThemeStore}
                <span className="sr-only"> {w.preview.opensNew}</span>
              </a>
              <ActionForm action={syncLaunchThemesAction}>
                <SubmitButton>{t.syncLaunch}</SubmitButton>
              </ActionForm>
            </div>
          }
          compact
        >
          <ul aria-label={t.launchList} className="flex flex-col gap-1 text-sm">
            {launch.map((theme) => (
              <li key={theme.key}>
                <span className="text-body-strong text-ink">{theme.title}</span>
                <span className="text-muted">
                  {" · "}
                  {theme.archived
                    ? t.launchArchived
                    : theme.published === null
                      ? theme.presetId
                        ? t.launchMade
                        : t.launchNotAdded
                      : theme.published >= theme.version
                        ? fillWords(t.launchUpToDate, { version: theme.version })
                        : fillWords(t.launchWaiting, { published: theme.published, version: theme.version })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {current && (
        <Card title={t.newTitle} description={t.newDescription} className="flex flex-col gap-3" compact>
          <ActionForm action={createDesignAction} className="flex max-w-3xl flex-col gap-3">
            <label className={field}>
              {t.fieldTitle}
              <input name="title" required maxLength={DESIGN_LIMITS.title} className={control} />
            </label>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">{t.startFrom}</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="origin" value="scratch" defaultChecked className="mt-0.5 size-4" />
                <span>
                  {t.scratch}
                  <span className="block text-muted">{t.scratchHint}</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="origin" value="store" disabled={sources.length === 0} className="mt-0.5 size-4" />
                <span>
                  {t.storeLook}
                  <span className="block text-muted">
                    {sources.length === 0 ? t.storeLookNone : t.storeLookHint}
                  </span>
                </span>
              </label>
            </fieldset>
            {sources.length > 0 && (
              <label className={field}>
                {t.theStore} <span className="font-normal text-muted">{t.theStoreHint}</span>
                <select name="store" className={control}>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} ({w.kinds[source.kind]}, /s/{source.slug})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={field}>
              {t.contentStart} <span className="font-normal text-muted">{t.contentStartHint}</span>
              <select name="content" defaultValue={contents.find((c) => c.kind === "pack")?.id ?? ""} className={control}>
                {contents.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title} ({w.contentSources[source.kind]})
                  </option>
                ))}
                <option value="">{t.contentNone}</option>
              </select>
            </label>
            <label className={field}>
              {t.summary} <span className="font-normal text-muted">{t.summaryHint}</span>
              <input name="summary" maxLength={DESIGN_LIMITS.summary} className={control} />
            </label>
            <label className={field}>
              {t.descriptionField}
              <textarea name="description" rows={3} maxLength={DESIGN_LIMITS.description} className={`${control} py-2`} />
            </label>
            <div>
              <SubmitButton>{t.make}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
    </AdminTextScope>
  );
}

function DesignItem({
  design,
  facts,
  madeCard,
  first,
  last,
  archived,
  w,
}: {
  design: DesignRow;
  facts: LifecycleFacts & { used: boolean };
  /** The photograph of its own look made for cards (D264), when it has one. */
  madeCard: string | null;
  first: boolean;
  last: boolean;
  archived: boolean;
  w: PlatformSiteMessages;
}) {
  const t = w.themes;
  const shown = shownDesignDetails(design);
  const picture = shown.pictureUrl ?? madeCard;
  const edit = "flex min-h-10 items-center gap-1.5 rounded-md border border-edge px-3 text-sm hover:bg-sunken";
  return (
    <li className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4 md:flex-row md:items-start">
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- a theme's picture from Kaizen's media library, or its photograph (D264)
        <img src={picture} alt="" loading="lazy" className="aspect-video w-full rounded-md border border-line object-cover object-top md:w-48" />
      ) : (
        <div aria-hidden="true" className="hidden aspect-video w-48 rounded-md border border-dashed border-line md:block" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">
          {shown.title}
          <LifecycleBadge facts={facts} words={w.lifecycle} />
          {!design.readable && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal">{t.unreadable}</span>}
        </span>
        <span className="text-muted">
          {!archived && fillWords(t.position, { n: design.position })}
          {design.publishedAt ? fillWords(t.publishedOn, { date: design.publishedAt.slice(0, 10) }) : t.neverPublished}
          {countWords(design.storesUsing, t.applied)}
          {design.requests > 0 && countWords(design.requests, t.chosen)}
        </span>
        {shown.summary && <span>{shown.summary}</span>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={designTabHref(design.id, "details")} className={edit}>
            {t.edit}
            <span className="sr-only"> {shown.title}</span>
          </Link>
          <PreviewLink href={designPreviewPath(design.id, null, true)} label={design.published ? w.preview.asPublished : w.preview.preview} title={shown.title} of={w.preview.of} />
          {design.workspaceStoreId && facts.changed && <PreviewLink href={designPreviewPath(design.id, null, true, true)} label={w.preview.draft} title={shown.title} of={w.preview.of} />}
          <LifecycleButtons
            kind="theme"
            title={shown.title}
            facts={facts}
            words={w.lifecycle}
            actions={{
              publish: publishDesignAction.bind(null, design.id),
              unpublish: unpublishDesignAction.bind(null, design.id),
              archive: archiveDesignAction.bind(null, design.id),
              restore: unarchiveDesignAction.bind(null, design.id),
              remove: deleteDesignAction.bind(null, design.id),
            }}
          />
          {!archived && !first && (
            <ActionForm action={moveDesignAction.bind(null, design.id, "up")}>
              <SubmitButton variant="secondary">
                {t.moveUp}
                <span className="sr-only"> {shown.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
          {!archived && !last && (
            <ActionForm action={moveDesignAction.bind(null, design.id, "down")}>
              <SubmitButton variant="secondary">
                {t.moveDown}
                <span className="sr-only"> {shown.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </li>
  );
}
