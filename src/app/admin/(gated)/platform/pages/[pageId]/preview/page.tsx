import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageArticle } from "@/components/page-article";
import { requirePlatformAdmin } from "@/server/auth";
import { getPageForEdit } from "@/server/pages";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/** The last saved draft of a page, as the site will show it once published (D42). */
export default async function PreviewPagePage({ params }: PageProps<"/admin/platform/pages/[pageId]/preview">) {
  await connection();
  await requirePlatformAdmin();
  const { pageId } = await params;
  const page = z.uuid().safeParse(pageId).success ? await getPageForEdit(pageId) : null;
  if (!page) notFound();
  return (
    <>
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background">
        <span>
          Preview of the saved draft.{" "}
          {page.state === "draft"
            ? "The page is not on the site yet."
            : page.state === "changed"
              ? "The site still shows the published version."
              : "This is what the site shows."}
        </span>
        <Link href={`/admin/platform/pages/${page.id}`} className="font-medium underline">
          Back to editing
        </Link>
      </p>
      <div className="mx-auto w-full max-w-5xl py-6">
        <PageArticle content={page.draft} />
      </div>
    </>
  );
}
