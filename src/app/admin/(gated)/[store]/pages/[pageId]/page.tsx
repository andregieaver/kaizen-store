import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { requireMember } from "@/server/auth";
import { getPageForEdit } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import { listTerms } from "@/server/taxonomy";

import { storePageContext } from "../context";

export const metadata: Metadata = { title: "Edit page" };

/** One of a store's pages in the editor (D53), opened from Pages or from the page itself. */
export default async function EditStorePagePage({ params, searchParams }: PageProps<"/admin/[store]/pages/[pageId]">) {
  const { store: storeSlug, pageId } = await params;
  const { store } = await requireMember(storeSlug);
  const [page, { saved: justSaved }, saved, library, terms] = await Promise.all([
    z.uuid().safeParse(pageId).success ? getPageForEdit(store.id, pageId) : null,
    searchParams,
    listSavedParts(store.id),
    // Kaizen's saved parts, to start from (D56).
    listSavedParts(null),
    listTerms({ storeId: store.id, contentType: "page" }),
  ]);
  if (!page) notFound();
  const context = storePageContext(store);
  return (
    <>
      <h1 className="sr-only">Edit {page.draft.title || "Untitled page"}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={
          justSaved === "draft" ? "Draft saved." : justSaved === "published" ? `Published at ${context.siteBase}/${page.slug}.` : null
        }
        savedParts={saved}
        library={library}
        terms={terms}
        context={context}
      />
    </>
  );
}
