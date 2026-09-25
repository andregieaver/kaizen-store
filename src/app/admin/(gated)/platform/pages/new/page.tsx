import type { Metadata } from "next";
import { connection } from "next/server";

import { PageEditor } from "@/components/admin/page-editor";
import { requirePlatformAdmin } from "@/server/auth";
import { listSavedParts } from "@/server/saved-parts";
import { listTerms } from "@/server/taxonomy";

import { platformPageContext } from "../context";

export const metadata: Metadata = { title: "New page" };

export default async function NewPagePage() {
  await connection();
  await requirePlatformAdmin();
  const saved = await listSavedParts(null);
  const terms = await listTerms({ storeId: null, contentType: "page" });
  const context = await platformPageContext();
  return (
    <>
      {/* Only for screen readers: the title is in the editor, and Pages is in the menu. */}
      <h1 className="sr-only">New page</h1>
      <PageEditor
        page={null}
        savedParts={saved}
        terms={terms}
        context={context}
      />
    </>
  );
}
