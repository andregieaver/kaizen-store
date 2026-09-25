import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { siteUrl } from "@/lib/site";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { getPageForEdit } from "@/server/pages";
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
  const [page, { saved }] = await Promise.all([load(params), searchParams]);
  if (!page) notFound();
  return (
    <>
      <div>
        <Link href="/admin/platform/pages" className="text-sm underline">
          ← Pages
        </Link>
        <h1 className="text-2xl font-semibold">{page.draft.title || "Untitled page"}</h1>
      </div>
      <PageEditor
        key={page.id}
        page={page}
        notice={saved === "draft" ? "Draft saved." : saved === "published" ? `Published at /${page.slug}.` : null}
        origin={siteUrl()}
        defaultDescription={PLATFORM_DEFAULTS.description}
        upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      />
    </>
  );
}
