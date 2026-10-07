import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { STARTER_CATEGORIES, STARTER_CATEGORY_LABELS, STARTER_LIMITS, type StarterRow } from "@/lib/store-starters";
import { requirePlatformAdmin } from "@/server/auth";
import { listStarters, starterPreviewHref } from "@/server/store-starters";

import { createStarterAction, moveStarterAction, openStarterAdminAction, publishStarterAction } from "./actions";

export const metadata: Metadata = { title: "Store templates" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";

/**
 * Store templates (D175, `docs/store-templates.md`): starting points for new stores, each a store set up for one kind of business.
 * Made here, set up in their own store admin, previewed in a new window, and offered to owners and the sign-up form once published.
 */
export default async function StoreTemplatesPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const starters = await listStarters();
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
        </p>
      </div>

      <p className="text-sm text-muted">
        {starters.length === 0
          ? "No store templates yet."
          : `${starters.length} ${starters.length === 1 ? "store template" : "store templates"}, ${published} published.`}
      </p>

      {starters.length > 0 && (
        <ol className="flex flex-col gap-3">
          {starters.map((starter, index) => (
            <StarterItem key={starter.id} starter={starter} first={index === 0} last={index === starters.length - 1} />
          ))}
        </ol>
      )}

      <section aria-labelledby="new-starter" className="flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <div>
          <h2 id="new-starter" className="font-medium">
            New store template
          </h2>
          <p className="text-sm text-muted">
            It starts as a copy of the demo template, with you as its owner, unpublished. Set it up in its admin like any
            store, then publish it.
          </p>
        </div>
        <ActionForm action={createStarterAction} className="flex flex-col gap-3">
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
    </div>
  );
}

function StarterItem({ starter, first, last }: { starter: StarterRow; first: boolean; last: boolean }) {
  const preview = starterPreviewHref(starter.storeSlug);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 md:flex-row md:items-start">
      {starter.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a template's picture from Kaizen's media library
        <img src={starter.pictureUrl} alt="" className="aspect-video w-full rounded-md border border-border object-cover md:w-48" />
      ) : (
        <div aria-hidden="true" className="hidden aspect-video w-48 rounded-md border border-dashed border-border md:block" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">
          {starter.title}
          <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-normal">{starter.published ? "Published" : "Not published"}</span>
        </span>
        <span className="text-muted">
          {STARTER_CATEGORY_LABELS[starter.category]} · /s/{starter.storeSlug} · position {starter.position}
          {starter.storesMade > 0 && ` · ${starter.storesMade} ${starter.storesMade === 1 ? "store" : "stores"} made from it`}
        </span>
        {starter.summary && <span>{starter.summary}</span>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={`/admin/platform/store-templates/${starter.id}`} className="flex min-h-10 items-center rounded-md border border-border px-3 hover:bg-surface">
            Edit details<span className="sr-only"> of {starter.title}</span>
          </Link>
          <ActionForm action={openStarterAdminAction.bind(null, starter.id)}>
            <SubmitButton variant="secondary">
              Open the store&apos;s admin<span className="sr-only"> of {starter.title}</span>
            </SubmitButton>
          </ActionForm>
          <a
            href={preview}
            target="_blank"
            rel="noopener"
            className="flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 hover:bg-surface"
          >
            Preview<span className="sr-only"> {starter.title} (opens in a new window)</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <ActionForm action={publishStarterAction.bind(null, starter.id, !starter.published)}>
            <SubmitButton variant={starter.published ? "secondary" : "primary"}>{starter.published ? "Unpublish" : "Publish"}
              <span className="sr-only"> {starter.title}</span>
            </SubmitButton>
          </ActionForm>
          {!first && (
            <ActionForm action={moveStarterAction.bind(null, starter.id, "up")}>
              <SubmitButton variant="secondary">
                Move up<span className="sr-only"> {starter.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
          {!last && (
            <ActionForm action={moveStarterAction.bind(null, starter.id, "down")}>
              <SubmitButton variant="secondary">
                Move down<span className="sr-only"> {starter.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </li>
  );
}
