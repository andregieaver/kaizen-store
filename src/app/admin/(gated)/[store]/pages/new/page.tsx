import type { Metadata } from "next";

import { PageEditor } from "@/components/admin/page-editor";
import { requireMember } from "@/server/auth";
import { listSavedParts } from "@/server/saved-parts";
import { listTerms } from "@/server/taxonomy";

import { storePageContext } from "../context";

export const metadata: Metadata = { title: "New page" };

export default async function NewStorePagePage({ params }: PageProps<"/admin/[store]/pages/new">) {
  const { store } = await requireMember((await params).store);
  const [saved, terms] = await Promise.all([
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: "page" }),
  ]);
  return (
    <>
      {/* Only for screen readers: the title is in the editor, and Pages is in the menu. */}
      <h1 className="sr-only">New page</h1>
      <PageEditor page={null} savedParts={saved} terms={terms} context={storePageContext(store)} />
    </>
  );
}
