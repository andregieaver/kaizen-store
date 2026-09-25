import type { Metadata } from "next";
import { connection } from "next/server";

import { PageEditor } from "@/components/admin/page-editor";
import { siteUrl } from "@/lib/site";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { listSavedParts } from "@/server/saved-parts";
import { listTerms } from "@/server/taxonomy";
import { listGridStores } from "@/server/content-grid";
import { PLATFORM_DEFAULTS } from "@/server/seo";

import { uploadPlatformImageAction } from "../../actions";

export const metadata: Metadata = { title: "New page" };

export default async function NewPagePage() {
  await connection();
  await requirePlatformAdmin();
  const saved = await listSavedParts();
  const terms = await listTerms({ storeId: null, contentType: "page" });
  const gridStores = await listGridStores();
  return (
    <>
      {/* Only for screen readers: the title is in the editor, and Pages is in the menu. */}
      <h1 className="sr-only">New page</h1>
      <PageEditor
        page={null}
        origin={siteUrl()}
        defaultDescription={PLATFORM_DEFAULTS.description}
        savedParts={saved}
        terms={terms}
        gridStores={gridStores}
        upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      />
    </>
  );
}
