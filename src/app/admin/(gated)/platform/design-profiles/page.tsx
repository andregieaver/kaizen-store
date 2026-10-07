import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DesignPreviewLink } from "@/components/admin/design-cards";
import { DESIGN_LIMITS, designPreviewPath, type DesignRow } from "@/lib/design-presets";
import { requirePlatformAdmin } from "@/server/auth";
import { listDesigns, snapshotSources } from "@/server/design-presets";

import { createDesignAction, moveDesignAction, publishDesignAction, retakeDesignAction } from "./actions";

export const metadata: Metadata = { title: "Design profiles" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";
const KIND_WORDS = { template: "the demo template", starter: "store template", store: "store" } as const;

/**
 * Design profiles (D176, `docs/design-profiles.md`): a store's look (theme, header, footer, product layout and CSS) kept as a snapshot,
 * which any store can apply from its design settings, and which people creating a store choose after the store template.
 */
export default async function DesignProfilesPage() {
  await connection();
  const admin = await requirePlatformAdmin();
  const [designs, sources] = await Promise.all([listDesigns(), snapshotSources(admin)]);
  const published = designs.filter((d) => d.published).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Design profiles</h1>
        <p className="max-w-3xl text-sm text-muted">
          A store&apos;s look kept to use again: its theme (colours, fonts, buttons, corners, light and dark), its header and footer,
          its product page layout and its CSS. Never its name, logos, business details, menus&apos; links, pages or products. Owners
          apply one from their store&apos;s Design settings, and people creating a store choose one after the store template. Applying
          keeps the store&apos;s look from before, so it can be put back.
        </p>
      </div>

      <p className="text-sm text-muted">
        {designs.length === 0
          ? "No design profiles yet."
          : `${designs.length} ${designs.length === 1 ? "design profile" : "design profiles"}, ${published} published.`}
      </p>

      {designs.length > 0 && (
        <ol className="flex flex-col gap-3">
          {designs.map((design, index) => (
            <DesignItem key={design.id} design={design} first={index === 0} last={index === designs.length - 1} />
          ))}
        </ol>
      )}

      <section aria-labelledby="new-design" className="flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <div>
          <h2 id="new-design" className="font-medium">
            New design profile from a store
          </h2>
          <p className="text-sm text-muted">
            It keeps the store&apos;s look as it is now, unpublished. Set the look up in that store&apos;s admin first (Design, Headers,
            Footers, Product layouts, Custom CSS); you can update the profile from its store later.
          </p>
        </div>
        {sources.length === 0 ? (
          <p className="text-sm">You work in no store yet. Open a store template&apos;s admin from Store templates first.</p>
        ) : (
          <ActionForm action={createDesignAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={field}>
                Title
                <input name="title" required maxLength={DESIGN_LIMITS.title} className={control} />
              </label>
              <label className={field}>
                From the store
                <select name="store" required className={control}>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} ({KIND_WORDS[source.kind]}, /s/{source.slug})
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
        )}
      </section>
    </div>
  );
}

function DesignItem({ design, first, last }: { design: DesignRow; first: boolean; last: boolean }) {
  const button = "flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 hover:bg-surface";
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 md:flex-row md:items-start">
      {design.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a profile's picture from Kaizen's media library
        <img src={design.pictureUrl} alt="" className="aspect-video w-full rounded-md border border-border object-cover md:w-48" />
      ) : (
        <div aria-hidden="true" className="hidden aspect-video w-48 rounded-md border border-dashed border-border md:block" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium">
          {design.title}
          <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-normal">{design.published ? "Published" : "Not published"}</span>
          {!design.readable && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-normal">Cannot be read: update it</span>}
        </span>
        <span className="text-muted">
          position {design.position} · from {design.sourceStoreName ? `${design.sourceStoreName} (/s/${design.sourceStoreSlug})` : "a store that is gone"} · taken{" "}
          {design.snapshotAt.slice(0, 10)}
          {` · applied to ${design.storesUsing} ${design.storesUsing === 1 ? "store" : "stores"}`}
          {design.recommendedBy.length > 0 && ` · recommended by ${design.recommendedBy.join(", ")}`}
        </span>
        {design.summary && <span>{design.summary}</span>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={`/admin/platform/design-profiles/${design.id}`} className={button}>
            Edit details<span className="sr-only"> of {design.title}</span>
          </Link>
          <DesignPreviewLink href={designPreviewPath(design.id, null, true)} title={design.title} className={button} />
          <ActionForm action={retakeDesignAction.bind(null, design.id)}>
            <SubmitButton variant="secondary">
              Update from its store<span className="sr-only"> ({design.title})</span>
            </SubmitButton>
          </ActionForm>
          <ActionForm action={publishDesignAction.bind(null, design.id, !design.published)}>
            <SubmitButton variant={design.published ? "secondary" : "primary"}>
              {design.published ? "Unpublish" : "Publish"}
              <span className="sr-only"> {design.title}</span>
            </SubmitButton>
          </ActionForm>
          {!first && (
            <ActionForm action={moveDesignAction.bind(null, design.id, "up")}>
              <SubmitButton variant="secondary">
                Move up<span className="sr-only"> {design.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
          {!last && (
            <ActionForm action={moveDesignAction.bind(null, design.id, "down")}>
              <SubmitButton variant="secondary">
                Move down<span className="sr-only"> {design.title}</span>
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </li>
  );
}
