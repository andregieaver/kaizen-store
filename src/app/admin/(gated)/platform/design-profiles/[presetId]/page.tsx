import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StarterPictureField } from "@/components/admin/starter-picture-field";
import { DESIGN_LIMITS, designPreviewPath } from "@/lib/design-presets";
import { requirePlatformAdmin } from "@/server/auth";
import { getDesign } from "@/server/design-presets";
import { listStarters } from "@/server/store-starters";

import { uploadPlatformImageAction } from "../../actions";
import { updateDesignAction } from "../actions";

export const metadata: Metadata = { title: "Design profile" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";

/** One design profile's details (D176): what stores read on its card, and its picture; previews on each store template. */
export default async function DesignProfilePage({ params }: PageProps<"/admin/platform/design-profiles/[presetId]">) {
  await connection();
  await requirePlatformAdmin();
  const [design, starters] = await Promise.all([getDesign((await params).presetId), listStarters()]);
  if (!design) notFound();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/admin/platform/design-profiles" className="text-sm underline underline-offset-2">
          Design profiles
        </Link>
        <h1 className="text-2xl font-semibold">{design.title}</h1>
        <p className="text-sm text-muted">
          {design.published ? "Published" : "Not published"} · taken from {design.sourceStoreName ?? "a store that is gone"} on{" "}
          {design.snapshotAt.slice(0, 10)} · applied to {design.storesUsing} {design.storesUsing === 1 ? "store" : "stores"}
        </p>
      </div>
      <section aria-labelledby="previews" className="flex flex-col gap-2 text-sm">
        <h2 id="previews" className="font-medium">
          Preview
        </h2>
        <p className="text-muted">Opens in a new window: the front page and a product of a store template, drawn with this look. Nothing is changed.</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <li>
            <a href={designPreviewPath(design.id, null, true)} target="_blank" rel="noopener" className="underline underline-offset-2">
              On the Standard store<span className="sr-only"> (opens in a new window)</span>
            </a>
          </li>
          {starters.map((starter) => (
            <li key={starter.id}>
              <a href={designPreviewPath(design.id, starter.id, true)} target="_blank" rel="noopener" className="underline underline-offset-2">
                On {starter.title}
                {!starter.published && " (not published)"}
                <span className="sr-only"> (opens in a new window)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <ActionForm action={updateDesignAction.bind(null, design.id)} className="flex flex-col gap-4">
        <label className={field}>
          Title
          <input name="title" required maxLength={DESIGN_LIMITS.title} defaultValue={design.title} className={control} />
        </label>
        <label className={field}>
          Summary <span className="font-normal text-muted">(on the card, up to {DESIGN_LIMITS.summary} characters)</span>
          <input name="summary" maxLength={DESIGN_LIMITS.summary} defaultValue={design.summary} className={control} />
        </label>
        <label className={field}>
          Description <span className="font-normal text-muted">(plain text)</span>
          <textarea name="description" rows={6} maxLength={DESIGN_LIMITS.description} defaultValue={design.description} className={`${control} py-2`} />
        </label>
        <StarterPictureField initial={design.pictureUrl} upload={uploadPlatformImageAction} />
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
