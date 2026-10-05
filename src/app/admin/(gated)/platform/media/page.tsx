import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { MediaLibrary } from "@/components/admin/media-library";
import { mediaQuery } from "@/lib/media-query";
import { requirePlatformAdmin } from "@/server/auth";
import { aiFor } from "@/server/ai";
import { altSite, missingAltTexts } from "@/server/alt-texts";
import { uploadsEnabled } from "@/server/media";
import { listMedia } from "@/server/media-library";

import { startPlatformVideoUploadAction, uploadPlatformImageAction } from "../actions";
import {
  deleteManyPlatformMediaAction,
  deletePlatformMediaAction,
  describePlatformMediaAction,
  measurePlatformMediaAction,
  writePlatformAltTextAction,
  writePlatformAltTextsAction,
} from "./actions";

export const metadata: Metadata = { title: "Media library" };

/** Kaizen's own media library (D88), as a store's. */
export default async function PlatformMediaPage({ searchParams }: PageProps<"/admin/platform/media">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Media library</h1>
        <p className="max-w-2xl text-sm text-muted">
          Every picture and video uploaded for Kaizen&apos;s own site, here or in any editor. Add many at once, find them by
          name or alt text, give pictures alt texts (or let the AI write them), and see where each one is used on the site.
        </p>
      </div>
      {/* The search in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-background" />}>
        <Library searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Library({ searchParams }: { searchParams: PageProps<"/admin/platform/media">["searchParams"] }) {
  await requirePlatformAdmin();
  const query = mediaQuery(await searchParams);
  const owner = { storeId: null, storeSlug: null };
  const [{ items, total, searched }, ai, site, altMissing] = await Promise.all([
    listMedia(owner, query),
    aiFor(null),
    altSite(owner),
    missingAltTexts(owner),
  ]);
  return (
    <MediaLibrary
      items={items}
      total={total}
      query={query}
      searched={searched}
      meaning={Boolean(ai?.space)}
      basePath="/admin/platform/media"
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
    />
  );
}
