import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { PageEditor } from "@/components/admin/page-editor";
import { siteUrl } from "@/lib/site";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { PLATFORM_DEFAULTS } from "@/server/seo";

import { uploadPlatformImageAction } from "../../actions";

export const metadata: Metadata = { title: "New page" };

export default async function NewPagePage() {
  await connection();
  await requirePlatformAdmin();
  return (
    <>
      <div>
        <Link href="/admin/platform/pages" className="text-sm underline">
          ← Pages
        </Link>
        <h1 className="text-2xl font-semibold">New page</h1>
      </div>
      <PageEditor
        page={null}
        origin={siteUrl()}
        defaultDescription={PLATFORM_DEFAULTS.description}
        upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      />
    </>
  );
}
