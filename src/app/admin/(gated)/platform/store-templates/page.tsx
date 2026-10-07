import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LifecycleBadge, LifecycleButtons } from "@/components/admin/lifecycle-buttons";
import { PreviewLink } from "@/components/admin/preview-link";
import { listFilterOf } from "@/lib/lifecycle";
import { STARTER_CATEGORIES, STARTER_CATEGORY_LABELS, STARTER_LIMITS, type StarterRow } from "@/lib/store-starters";
import { requirePlatformAdmin } from "@/server/auth";
import { listStarters, shownDetails, starterLifecycle, starterPreviewHref } from "@/server/store-starters";

import {
  archiveStarterAction,
  createStarterAction,
  deleteStarterAction,
  moveStarterAction,
  openStarterAdminAction,
  publishStarterAction,
  restoreStarterAction,
  unpublishStarterAction,
} from "./actions";

export const metadata: Metadata = { title: "Store templates" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const button = "flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-surface";

/**
 * Store templates (D175, `docs/store-templates.md`): starting points for new stores, each a store set up for one kind of business.
 * Made here, set up in their own store admin, previewed in a new window, and offered to owners and the sign-up form once published (D177: a
 * frozen copy of the store as it was when published). Archived ones are listed only under Archived.
 */
export default async function StoreTemplatesPage({ searchParams }: PageProps<"/admin/platform/store-templates">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const query = await searchParams;
  const filter = listFilterOf(query.show);
  const starters = await listStarters(filter);
  const published = starters.filter((s) => s.published).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Store templates</h1>
        <p className="max-w-3xl text-sm text-muted">
          Starting points for new stores: each is a store of its own, set up for one kind of business with its modules,
          products and services, staff and opening hours, pages, menus, legal page drafts, shipping and checkout settings.
          Owners choose one when they create a store, and so do people asking for a store at sign-up; the Standard store
          (the demo template) is always offered first. A template takes no orders and is never shown to search engines.
          Changes to a template, its details or its store, reach owners only when you publish it: publishing keeps a copy of its store as it
          is then, which new stores are made from.
        </p>
      </div>

      <nav aria-label="Which store templates" className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/platform/store-templates" aria-current={filter === "current" ? "page" : undefined} className={`${button} aria-[current=page]:bg-surface aria-[current=page]:font-medium`}>
          Store templates
        </Link>
        <Link href="/admin/platform/store-templates?show=archived" aria-current={filter === "archived" ? "page" : undefined} className={`${button} aria-[current=page]:bg-surface aria-[current=page]:font-medium`}>
          Archived
        </Link>
      </nav>

      {query.deleted && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          The store template was deleted. Its store and published copies are closed and kept.
        </p>
      )}

      <p className="text-sm text-muted">
        {filter === "archived"
          ? starters.length === 0
            ? "No archived store templates."
            : `${starters.length} archived ${starters.length === 1 ? "store template" : "store templates"}. Restore one to use it again.`
          : starters.length === 0
            ? "No store templates yet."
            : `${starters.length} ${starters.length === 1 ? "store template" : "store templates"}, ${published} published.`}
      </p>

      {starters.length > 0 && (
        <ol className="flex flex-col gap-3">
          {starters.map((starter, index) => (
            <StarterItem key={starter.id} starter={starter} first={index === 0} last={index === starters.length - 1} archived={filter === "archived"} />
          ))}
        </ol>
      )}

      {filter === "current" && (
        <section aria-labelledby="new-starter" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <div>
            <h2 id="new-starter" className="font-medium">
              New store template
            </h2>
            <p className="text-sm text-muted">
              It starts as a copy of the demo template, with you as its owner, unpublished. Set it up in its admin like any
              store, then publish it.
            </p>
          </div>
          <ActionForm action={createStarterAction} className="flex max-w-3xl flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={field}>
                Title
                <input name="title" required maxLength={STARTER_LIMITS.title} className={control} />
              </label>
              <label className={field}>
                Store address
                <span className="flex items-center gap-1 font-normal">
                  <span className="text-muted">/s/</span>
                  <input
                    name="slug"
                    pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-describedby="starter-slug-hint"
                    className={`${control} w-full`}
                  />
                </span>
                <span id="starter-slug-hint" className="font-normal text-muted">
                  Leave empty to make one from the title.
                </span>
              </label>
              <label className={field}>
                Category
                <select name="category" required defaultValue="appointments" className={control}>
                  {STARTER_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {STARTER_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Summary <span className="font-normal text-muted">(on the card)</span>
                <input name="summary" maxLength={STARTER_LIMITS.summary} className={control} />
              </label>
            </div>
            <label className={field}>
              Description
              <textarea name="description" rows={3} maxLength={STARTER_LIMITS.description} className={`${control} py-2`} />
            </label>
            <div>
              <SubmitButton>Make the store template</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}

function StarterItem({ starter, first, last, archived }: { starter: StarterRow; first: boolean; last: boolean; archived: boolean }) {
  const shown = shownDetails(starter);
  const facts = starterLifecycle(starter);
  const usage = [
    starter.storesMade > 0 && `${starter.storesMade} ${starter.storesMade === 1 ? "store" : "stores"} made from it`,
    starter.requests > 0 && `${starter.requests} ${starter.requests === 1 ? "access request" : "access requests"}`,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 md:flex-row md:items-start">
      {shown.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a template's picture from Kaizen's media library
        <img src={shown.pictureUrl} alt="" className="aspect-video w-full rounded-md border border-border object-cover md:w-48" />
      ) : (
        <div aria-hidden="true" className="hidden aspect-video w-48 rounded-md border border-dashed border-border md:block" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">
          {shown.title}
          <LifecycleBadge facts={facts} />
        </span>
        <span className="text-muted">
          {STARTER_CATEGORY_LABELS[shown.category]} · its store /s/{starter.storeSlug}
          {!archived && ` · position ${starter.position}`}
          {starter.publishedAt && ` · published ${starter.publishedAt.slice(0, 10)}`}
          {usage.length > 0 && ` · ${usage.join(", ")}`}
        </span>
        {starter.draft && <span className="text-muted">Its details have changes not published yet.</span>}
        {starter.changedInStore && <span className="text-muted">Its store changed since it was published: new stores get the published copy until you publish again.</span>}
        {starter.published && !starter.publishedSlug && (
          <span className="text-muted">Published before copies were kept: new stores copy its store as it is now. Publish it again to keep a copy.</span>
        )}
        {shown.summary && <span>{shown.summary}</span>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={`/admin/platform/store-templates/${starter.id}`} className={button}>
            Edit details<span className="sr-only"> of {shown.title}</span>
          </Link>
          {!archived && (
            <ActionForm action={openStarterAdminAction.bind(null, starter.id)}>
              <SubmitButton variant="secondary">
                Open the store&apos;s admin<span className="sr-only"> of {shown.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
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
          {!archived && !first && (
            <ActionForm action={moveStarterAction.bind(null, starter.id, "up")}>
              <SubmitButton variant="secondary">
                Move up<span className="sr-only"> {shown.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
          {!archived && !last && (
            <ActionForm action={moveStarterAction.bind(null, starter.id, "down")}>
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
