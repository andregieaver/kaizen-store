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
import { listStarters } from "@/server/store-starters";
import { Card, PageHeader } from "@/components/admin/ui";
import { THEMES_ADMIN } from "@/lib/theme-admin-paths";

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

export const metadata: Metadata = { title: "Themes" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const tab = "flex min-h-10 items-center rounded-md border border-edge px-3 text-sm hover:bg-sunken aria-[current=page]:bg-sunken aria-[current=page]:font-medium";
const KIND_WORDS = { template: "the Standard store", starter: "demo store", store: "store" } as const;

/**
 * Themes (D176, D177, D273, `docs/themes-unified.md`): a look (theme, header, footer, product layout and CSS) with its presets, which any
 * store can apply from its design settings and people creating a store start from, each look with the demo store it is shown on and a new
 * store is copied from. Made from a store or from scratch and edited on the theme's own pages; archived ones are listed only under Archived.
 * The demo stores are set up here too.
 */
export default async function ThemesPage({ searchParams }: PageProps<"/admin/platform/themes">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const query = await searchParams;
  const filter = listFilterOf(query.show);
  const current = filter === "current";
  const [designs, sources, launch, packs, starters] = await Promise.all([
    listDesigns(filter),
    snapshotSources(admin),
    launchThemeStates(),
    current ? contentPackStates() : Promise.resolve([]),
    current ? listStarters() : Promise.resolve([]),
  ]);
  const facts = await Promise.all(designs.map((design) => designLifecycle(design)));
  const published = designs.filter((d) => d.published).length;
  // Which themes each demo store shows (any of their looks), for its row; older store templates are those no content pack made.
  const shownOn: Record<string, string[]> = {};
  for (const design of designs) {
    for (const pack of new Set([design.listing.pack, ...Object.values(design.listing.presetPacks)])) if (pack) (shownOn[pack] ??= []).push(design.title);
  }
  const packStores = new Set(packs.map((pack) => pack.starterId));
  const older = starters.filter((starter) => !packStores.has(starter.id));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Themes"
        description={<>A theme is a whole look (colours, fonts, buttons, corners, light and dark, a header and footer, a product page and CSS) with up to five presets over it. Each look is shown on a demo store, and a new store started from it begins as a copy of that demo store. Owners apply a theme from their store&apos;s Design settings, which never changes their words; people creating a store choose one. Every change is a draft until you publish it.</>}
      />

      <nav aria-label="Which themes" className="flex flex-wrap gap-2">
        <Link href={THEMES_ADMIN} aria-current={current ? "page" : undefined} className={tab}>
          Themes
        </Link>
        <Link href={`${THEMES_ADMIN}?show=archived`} aria-current={filter === "archived" ? "page" : undefined} className={tab}>
          Archived
        </Link>
      </nav>

      {query.deleted && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {query.deleted === "demo" ? "The demo store was deleted. Its store and published copies are closed and kept." : "The theme was deleted; its workspace is closed and kept."}
        </p>
      )}

      <p className="text-sm text-muted">
        {filter === "archived"
          ? designs.length === 0
            ? "No archived themes."
            : `${designs.length} archived ${designs.length === 1 ? "theme" : "themes"}. Restore one to use it again.`
          : designs.length === 0
            ? "No themes yet."
            : `${designs.length} ${designs.length === 1 ? "theme" : "themes"}, ${published} published.`}
      </p>

      {designs.length > 0 && (
        <ol className="flex flex-col gap-3">
          {designs.map((design, index) => (
            <DesignItem key={design.id} design={design} facts={facts[index]} first={index === 0} last={index === designs.length - 1} archived={filter === "archived"} />
          ))}
        </ol>
      )}

      {current && <DemoStoresCard packs={packs} older={older} shownOn={shownOn} />}

      {current && (
        <Card
          title="Kaizena Flow's themes"
          description={<>The launch themes are written in Kaizena Flow&apos;s code, each passing the theme checks. Adding makes and publishes the ones not here yet; when the code has a newer version of one, it is published as a new version, which stores that follow updates take with their own changes kept. An archived one is left alone.</>}
          aside={
            <div className="flex flex-wrap items-center gap-3">
              <a href="/themes" target="_blank" rel="noopener" className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm underline underline-offset-2">
                Open the theme store<span className="sr-only"> (opens in a new window)</span>
              </a>
              <ActionForm action={syncLaunchThemesAction}>
                <SubmitButton>Add and update Kaizena Flow&apos;s themes</SubmitButton>
              </ActionForm>
            </div>
          }
          compact
        >
          <ul aria-label="Launch themes" className="flex flex-col gap-1 text-sm">
            {launch.map((theme) => (
              <li key={theme.key}>
                <span className="text-body-strong text-ink">{theme.title}</span>
                <span className="text-muted">
                  {" · "}
                  {theme.archived
                    ? "archived, left alone"
                    : theme.published === null
                      ? theme.presetId
                        ? "made, not published yet"
                        : "not added yet"
                      : theme.published >= theme.version
                        ? `version ${theme.version}, up to date`
                        : `version ${theme.published} published, version ${theme.version} waiting`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {current && (
        <Card title="New theme" description={<>Start from a store&apos;s look as it is now, or from Kaizena Flow&apos;s standard look, then set it up on the theme&apos;s own pages (theme settings, presets, header, footer, product page and CSS). It stays unpublished until you publish it.</>} className="flex flex-col gap-3" compact>
          <ActionForm action={createDesignAction} className="flex max-w-3xl flex-col gap-3">
            <label className={field}>
              Title
              <input name="title" required maxLength={DESIGN_LIMITS.title} className={control} />
            </label>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">Start from</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="origin" value="scratch" defaultChecked className="mt-0.5 size-4" />
                <span>
                  Scratch
                  <span className="block text-muted">Kaizena Flow&apos;s standard look: the standard theme, header, footer and product page, no CSS.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="origin" value="store" disabled={sources.length === 0} className="mt-0.5 size-4" />
                <span>
                  A store&apos;s look
                  <span className="block text-muted">
                    {sources.length === 0
                      ? "You work in no store yet: open a demo store's admin from Demo stores first."
                      : "Its theme, header, footer, product page and CSS as they are now, to change here; the store is not touched."}
                  </span>
                </span>
              </label>
            </fieldset>
            {sources.length > 0 && (
              <label className={field}>
                The store <span className="font-normal text-muted">(when starting from a store&apos;s look)</span>
                <select name="store" className={control}>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} ({KIND_WORDS[source.kind]}, /s/{source.slug})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={field}>
              Summary <span className="font-normal text-muted">(on the card)</span>
              <input name="summary" maxLength={DESIGN_LIMITS.summary} className={control} />
            </label>
            <label className={field}>
              Description
              <textarea name="description" rows={3} maxLength={DESIGN_LIMITS.description} className={`${control} py-2`} />
            </label>
            <div>
              <SubmitButton>Make the theme</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

function DesignItem({
  design,
  facts,
  first,
  last,
  archived,
}: {
  design: DesignRow;
  facts: LifecycleFacts & { used: boolean };
  first: boolean;
  last: boolean;
  archived: boolean;
}) {
  const shown = shownDesignDetails(design);
  const edit = "flex min-h-10 items-center gap-1.5 rounded-md border border-edge px-3 text-sm hover:bg-sunken";
  return (
    <li className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4 md:flex-row md:items-start">
      {shown.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a theme's picture from Kaizen's media library
        <img src={shown.pictureUrl} alt="" className="aspect-video w-full rounded-md border border-line object-cover md:w-48" />
      ) : (
        <div aria-hidden="true" className="hidden aspect-video w-48 rounded-md border border-dashed border-line md:block" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">
          {shown.title}
          <LifecycleBadge facts={facts} />
          {!design.readable && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal">Cannot be read: publish it again</span>}
        </span>
        <span className="text-muted">
          {!archived && `position ${design.position} · `}
          {design.publishedAt ? `published ${design.publishedAt.slice(0, 10)}` : "never published"}
          {` · applied to ${design.storesUsing} ${design.storesUsing === 1 ? "store" : "stores"}`}
          {design.requests > 0 && ` · chosen on ${design.requests} ${design.requests === 1 ? "access request" : "access requests"}`}
        </span>
        {shown.summary && <span>{shown.summary}</span>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={designTabHref(design.id, "details")} className={edit}>
            Edit<span className="sr-only"> {shown.title}</span>
          </Link>
          <PreviewLink href={designPreviewPath(design.id, null, true)} label={design.published ? "Preview as published" : "Preview"} title={shown.title} />
          {design.workspaceStoreId && facts.changed && <PreviewLink href={designPreviewPath(design.id, null, true, true)} label="Preview the draft" title={shown.title} />}
          <LifecycleButtons
            kind="theme"
            title={shown.title}
            facts={facts}
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
                Move up<span className="sr-only"> {shown.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
          {!archived && !last && (
            <ActionForm action={moveDesignAction.bind(null, design.id, "down")}>
              <SubmitButton variant="secondary">
                Move down<span className="sr-only"> {shown.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </li>
  );
}
