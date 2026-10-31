import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { MediaLibrary } from "@/components/admin/media-library";
import { mediaQuery } from "@/lib/media-query";
import { requirePlatformAdmin } from "@/server/auth";
import { aiFor } from "@/server/ai";
import { altSite, missingAltTexts } from "@/server/alt-texts";
import { uploadsEnabled } from "@/server/media";
import { compressibleCount, listMedia } from "@/server/media-library";
import { PageHeader } from "@/components/admin/ui";

import { startPlatformVideoUploadAction, uploadPlatformImageAction } from "../actions";
import {
  compressiblePlatformMediaAction,
  compressPlatformPictureAction,
  deleteManyPlatformMediaAction,
  deletePlatformMediaAction,
  describePlatformMediaAction,
  finishCompressedPlatformVideoAction,
  measurePlatformMediaAction,
  startCompressedPlatformVideoAction,
  writePlatformAltTextAction,
  writePlatformAltTextsAction,
} from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";
import { AdminAreas } from "@/components/admin/admin-areas";

export const metadata: Metadata = { title: "Media library" };

/** Kaizen's own media library (D88), as a store's. */
export default async function PlatformMediaPage({ searchParams }: PageProps<"/admin/platform/media">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const { w } = await platformSiteWords();
  return (
    <AdminAreas areas={["website"]}>
    <>
      <PageHeader
        title={w.misc.media.title}
        description={w.misc.media.description}
      />
      {/* The search in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-card" />}>
        <Library searchParams={searchParams} />
      </Suspense>
    </>
    </AdminAreas>
  );
}

async function Library({ searchParams }: { searchParams: PageProps<"/admin/platform/media">["searchParams"] }) {
  await requirePlatformAdmin();
  const query = mediaQuery(await searchParams);
  const owner = { storeId: null, storeSlug: null };
  const [{ items, total, searched }, ai, site, altMissing, waiting] = await Promise.all([
    listMedia(owner, query),
    aiFor(null),
    altSite(owner),
    missingAltTexts(owner),
    compressibleCount(owner),
  ]);
  return (
    <MediaLibrary
      items={items}
      total={total}
      query={query}
      searched={searched}
      meaning={Boolean(ai?.space)}
      basePath="/admin/platform/media"
      pictures={{
        make: ai?.image && uploadsEnabled() ? "/admin/platform/media/make" : null,
        edit: ai?.image?.editModel && uploadsEnabled() ? "/admin/platform/media/edit" : null,
        settingsHref: "/admin/platform/ai",
      }}
      upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      startVideo={uploadsEnabled() ? startPlatformVideoUploadAction : null}
      actions={{
        describe: describePlatformMediaAction,
        writeAlt: writePlatformAltTextAction,
        writeAlts: writePlatformAltTextsAction,
        remove: deletePlatformMediaAction,
        removeMany: deleteManyPlatformMediaAction,
        measure: measurePlatformMediaAction,
      }}
      languages={site?.languages ?? []}
      altAi={Boolean(ai?.textModel)}
      altMissing={altMissing}
      compress={
        uploadsEnabled()
          ? {
              picture: compressPlatformPictureAction,
              startVideo: startCompressedPlatformVideoAction,
              finishVideo: finishCompressedPlatformVideoAction,
              waiting: compressiblePlatformMediaAction,
            }
          : null
      }
      waiting={waiting}
    />
  );
}
