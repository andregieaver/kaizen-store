import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { siteUrl } from "@/lib/site";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { getPageForEdit } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import { PLATFORM_DEFAULTS } from "@/server/seo";

import { uploadPlatformImageAction } from "../../actions";

type Props = PageProps<"/admin/platform/pages/[pageId]">;

async function load(params: Props["params"]) {
  const { pageId } = await params;
  return z.uuid().safeParse(pageId).success ? getPageForEdit(pageId) : null;
}

export const metadata: Metadata = { title: "Edit page" };

/** One of Kaizen's pages in the editor (D42), opened from Pages or from the page itself. */
export default async function EditPagePage({ params, searchParams }: Props) {
  await connection();
  await requirePlatformAdmin();
  const [page, { saved: justSaved }, saved] = await Promise.all([load(params), searchParams, listSavedParts()]);
  if (!page) notFound();
  return (
    <>
      {/* Only for screen readers: the title is in the editor, and Pages is in the menu. */}
      <h1 className="sr-only">Edit {page.draft.title || "Untitled page"}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={justSaved === "draft" ? "Draft saved." : justSaved === "published" ? `Published at /${page.slug}.` : null}
        origin={siteUrl()}
        defaultDescription={PLATFORM_DEFAULTS.description}
        savedParts={saved}
        upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      />
    </>
  );
}
