import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { MediaLibrary } from "@/components/admin/media-library";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { mediaQuery } from "@/lib/media-query";
import { WEBSITE_MEDIA_WORDS } from "@/lib/admin-words/website-media";
import { WEBSITE_PICK_WORDS } from "@/lib/admin-words/website-pick";
import { CANVA_WORDS } from "@/lib/admin-words/canva";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { canvaForLibrary } from "@/server/canva";
import { aiFor } from "@/server/ai";
import { altSite, missingAltTexts } from "@/server/alt-texts";
import { uploadsEnabled } from "@/server/media";
import { compressibleCount, listMedia } from "@/server/media-library";
import { PageHeader } from "@/components/admin/ui";

import { startPlatformVideoUploadAction, uploadPlatformImageAction } from "../upload-actions";
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
  await requirePlatformReader();
  const { w } = await platformSiteWords();
  return (
    <AdminAreas areas={{ websitePick: WEBSITE_PICK_WORDS, websiteMedia: WEBSITE_MEDIA_WORDS, canva: CANVA_WORDS }}>
    <>
      <PageHeader
        title={w.misc.media.title}
        description={<><span className="sm:hidden">{w.misc.media.lead}</span><span className="max-sm:hidden">{w.misc.media.description}</span></>}
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
  const account = await requirePlatformReader();
  const given = await searchParams;
  const query = mediaQuery(given);
  const owner = { storeId: null, storeSlug: null };
  const [{ items, total, searched }, ai, site, altMissing, waiting, canva] = await Promise.all([
    listMedia(owner, query),
    aiFor(null),
    altSite(owner),
    missingAltTexts(owner),
    compressibleCount(owner),
    // The person's own Canva (D898), for a platform admin who may change the site.
    platformCan(account, "website") && uploadsEnabled() ? canvaForLibrary({ ...owner, accountId: account.id }, given.canva) : null,
  ]);
  return (
    <MediaLibrary
      items={items}
      total={total}
      query={query}
      searched={searched}
      meaning={Boolean(ai?.space)}
      basePath="/admin/platform/media"
      timeZone={PLATFORM_TIME_ZONE}
      pictures={{
        make: ai?.image && uploadsEnabled() ? "/admin/platform/media/make" : null,
        edit: ai?.image?.editModel && uploadsEnabled() ? "/admin/platform/media/edit" : null,
        settingsHref: "/admin/platform/ai",
      }}
      canva={canva ? { ...canva, endpoint: "/admin/platform/media/canva", back: "/admin/platform/media" } : null}
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
