import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StarterPictureField } from "@/components/admin/starter-picture-field";
import { STARTER_CATEGORIES, STARTER_CATEGORY_LABELS, STARTER_LIMITS } from "@/lib/store-starters";
import { requirePlatformAdmin } from "@/server/auth";
import { listDesigns } from "@/server/design-presets";
import { getStarter, starterPreviewHref } from "@/server/store-starters";

import { uploadPlatformImageAction } from "../../actions";
import { recommendDesignAction } from "../../design-profiles/actions";
import { updateStarterAction } from "../actions";

export const metadata: Metadata = { title: "Store template" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";

/** One store template's details (D175): what owners read on its card, and its picture. What it holds is edited in its own store admin. */
export default async function StoreTemplatePage({ params }: PageProps<"/admin/platform/store-templates/[starterId]">) {
  await connection();
  await requirePlatformAdmin();
  const [starter, designs] = await Promise.all([getStarter((await params).starterId), listDesigns()]);
  if (!starter) notFound();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/admin/platform/store-templates" className="text-sm underline underline-offset-2">
          Store templates
        </Link>
        <h1 className="text-2xl font-semibold">{starter.title}</h1>
        <p className="text-sm text-muted">
          {starter.published ? "Published" : "Not published"} · its store is /s/{starter.storeSlug} ·{" "}
          <a href={starterPreviewHref(starter.storeSlug)} target="_blank" rel="noopener" className="underline underline-offset-2">
            Preview<span className="sr-only"> (opens in a new window)</span>
          </a>
        </p>
      </div>
      <ActionForm action={updateStarterAction.bind(null, starter.id)} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={field}>
            Title
            <input name="title" required maxLength={STARTER_LIMITS.title} defaultValue={starter.title} className={control} />
          </label>
          <label className={field}>
            Category
            <select name="category" required defaultValue={starter.category} className={control}>
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
          <input name="summary" maxLength={STARTER_LIMITS.summary} defaultValue={starter.summary} className={control} />
        </label>
        <label className={field}>
          Description <span className="font-normal text-muted">(plain text)</span>
          <textarea name="description" rows={6} maxLength={STARTER_LIMITS.description} defaultValue={starter.description} className={`${control} py-2`} />
        </label>
        <StarterPictureField initial={starter.pictureUrl} upload={uploadPlatformImageAction} />
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
      <section aria-labelledby="recommended-design" className="flex flex-col gap-2 rounded-lg border border-border bg-background p-5">
        <h2 id="recommended-design" className="font-medium">
          Recommended design profile
        </h2>
        <p className="text-sm text-muted">
          Chosen first when a store is made from this template (D176), while it is published; the person may choose another. To change this
          template&apos;s own look, apply a profile from its page under All stores, or edit it in its admin.
        </p>
        <ActionForm action={recommendDesignAction.bind(null, starter.id)} className="flex flex-wrap items-end gap-3">
          <label className={field}>
            Design profile
            <select name="design" defaultValue={starter.recommendedDesign ?? ""} className={control}>
              <option value="">None: the template&apos;s own look</option>
              {designs.map((design) => (
                <option key={design.id} value={design.id}>
                  {design.title}
                  {!design.published && " (not published)"}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
