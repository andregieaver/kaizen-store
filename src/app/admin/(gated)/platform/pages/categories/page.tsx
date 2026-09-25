import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { TermsManager } from "@/components/admin/terms";
import { requirePlatformAdmin } from "@/server/auth";
import { listTerms } from "@/server/taxonomy";

import { createPageTermAction, deletePageTermAction, updatePageTermAction } from "../actions";

export const metadata: Metadata = { title: "Page categories and tags" };

/** Kaizen's page categories and tags (D50): chosen on each page, shown by content grids. */
export default async function PageTermsPage() {
  await connection();
  await requirePlatformAdmin();
  const terms = await listTerms({ storeId: null, contentType: "page" });
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/platform/pages" className="w-fit text-sm underline">
          Pages
        </Link>
        <h1 className="text-2xl font-semibold">Categories and tags</h1>
        <p className="max-w-2xl text-sm text-muted">
          Sort Kaizen&apos;s pages into categories and label them with tags. Choose a page&apos;s categories and tags
          in the page editor; a content grid can then show the pages of a category or tag. A page&apos;s choices go on
          the site when it is published.
        </p>
      </div>
      <TermsManager
        initial={terms}
        usedBy="pages"
        actions={{ create: createPageTermAction, update: updatePageTermAction, remove: deletePageTermAction }}
      />
    </>
  );
}
