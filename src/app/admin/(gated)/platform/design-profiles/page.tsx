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

import {
  archiveDesignAction,
  createDesignAction,
  deleteDesignAction,
  moveDesignAction,
  publishDesignAction,
  unarchiveDesignAction,
  unpublishDesignAction,
} from "./actions";

export const metadata: Metadata = { title: "Design profiles" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const tab = "flex min-h-10 items-center rounded-md border border-border px-3 text-sm hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium";
const KIND_WORDS = { template: "the demo template", starter: "store template", store: "store" } as const;

/**
 * Design profiles (D176, D177, `docs/design-profiles.md`): a look (theme, header, footer, product layout and CSS) kept to use again, which
 * any store can apply from its design settings, and which people creating a store choose after the store template. Made from a store or
 * from scratch and edited on the profile's own pages; archived ones are listed only under Archived.
 */
export default async function DesignProfilesPage({ searchParams }: PageProps<"/admin/platform/design-profiles">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const query = await searchParams;
  const filter = listFilterOf(query.show);
  const [designs, sources] = await Promise.all([listDesigns(filter), snapshotSources(admin)]);
  const facts = await Promise.all(designs.map((design) => designLifecycle(design)));
  const published = designs.filter((d) => d.published).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Design profiles</h1>
        <p className="max-w-3xl text-sm text-muted">
          A look kept to use again: a theme (colours, fonts, buttons, corners, light and dark), a header and footer, a product page layout
          and CSS. Never a store&apos;s name, logos, business details, menus&apos; links, pages or products. Owners apply one from their
          store&apos;s Design settings, and people creating a store choose one after the store template. Applying keeps the store&apos;s look
          from before, so it can be put back. Every change is a draft until you publish it.
        </p>
      </div>

      <nav aria-label="Which design profiles" className="flex flex-wrap gap-2">
        <Link href="/admin/platform/design-profiles" aria-current={filter === "current" ? "page" : undefined} className={tab}>
          Design profiles
        </Link>
        <Link href="/admin/platform/design-profiles?show=archived" aria-current={filter === "archived" ? "page" : undefined} className={tab}>
          Archived
        </Link>
      </nav>

      {query.deleted && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          The design profile was deleted; its workspace is closed and kept.
          {typeof query.cleared === "string" && query.cleared && ` It was the recommended profile of ${query.cleared}, which recommend none now.`}
        </p>
      )}

      <p className="text-sm text-muted">
        {filter === "archived"
          ? designs.length === 0
            ? "No archived design profiles."
            : `${designs.length} archived ${designs.length === 1 ? "design profile" : "design profiles"}. Restore one to use it again.`
          : designs.length === 0
            ? "No design profiles yet."
            : `${designs.length} ${designs.length === 1 ? "design profile" : "design profiles"}, ${published} published.`}
      </p>

      {designs.length > 0 && (
        <ol className="flex flex-col gap-3">
          {designs.map((design, index) => (
            <DesignItem key={design.id} design={design} facts={facts[index]} first={index === 0} last={index === designs.length - 1} archived={filter === "archived"} />
          ))}
        </ol>
      )}

      {filter === "current" && (
        <section aria-labelledby="new-design" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <div>
            <h2 id="new-design" className="font-medium">
              New design profile
            </h2>
            <p className="text-sm text-muted">
              Start from a store&apos;s look as it is now, or from Kaizen&apos;s standard look, then set it up on the profile&apos;s own pages
              (theme, header, footer, product page and CSS). It stays unpublished until you publish it.
            </p>
          </div>
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
                  <span className="block text-muted">Kaizen&apos;s standard look: the standard theme, header, footer and product page, no CSS.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="origin" value="store" disabled={sources.length === 0} className="mt-0.5 size-4" />
                <span>
                  A store&apos;s look
                  <span className="block text-muted">
                    {sources.length === 0
                      ? "You work in no store yet: open a store template's admin from Store templates first."
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
              <SubmitButton>Make the design profile</SubmitButton>
            </div>
          </ActionForm>
        </section>
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
  const edit = "flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-surface";
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 md:flex-row md:items-start">
      {shown.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a profile's picture from Kaizen's media library
        <img src={shown.pictureUrl} alt="" className="aspect-video w-full rounded-md border border-border object-cover md:w-48" />
      ) : (
        <div aria-hidden="true" className="hidden aspect-video w-48 rounded-md border border-dashed border-border md:block" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">
          {shown.title}
          <LifecycleBadge facts={facts} />
          {!design.readable && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-normal">Cannot be read: publish it again</span>}
        </span>
        <span className="text-muted">
          {!archived && `position ${design.position} · `}
          {design.publishedAt ? `published ${design.publishedAt.slice(0, 10)}` : "never published"}
          {` · applied to ${design.storesUsing} ${design.storesUsing === 1 ? "store" : "stores"}`}
          {design.requests > 0 && ` · chosen on ${design.requests} ${design.requests === 1 ? "access request" : "access requests"}`}
          {design.recommendedBy.length > 0 && ` · recommended by ${design.recommendedBy.join(", ")}`}
        </span>
        {shown.summary && <span>{shown.summary}</span>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={designTabHref(design.id, "details")} className={edit}>
            Edit<span className="sr-only"> {shown.title}</span>
          </Link>
          <PreviewLink href={designPreviewPath(design.id, null, true)} label={design.published ? "Preview as published" : "Preview"} title={shown.title} />
          {design.workspaceStoreId && facts.changed && <PreviewLink href={designPreviewPath(design.id, null, true, true)} label="Preview the draft" title={shown.title} />}
          <LifecycleButtons
            kind="design profile"
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
