import type { Metadata } from "next";
import { Suspense } from "react";

import { MediaLibrary } from "@/components/admin/media-library";
import { mediaQuery } from "@/lib/media-query";
import { requirePermission } from "@/server/permissions";
import { aiFor } from "@/server/ai";
import { altSite, missingAltTexts } from "@/server/alt-texts";
import { uploadsEnabled } from "@/server/media";
import { compressibleCount, listMedia } from "@/server/media-library";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";

import { startVideoUploadAction, uploadImageAction } from "../products/actions";
import {
  compressibleMediaAction,
  compressPictureAction,
  deleteManyMediaAction,
  deleteMediaAction,
  describeMediaAction,
  finishCompressedVideoAction,
  measureMediaAction,
  startCompressedVideoAction,
  writeAltTextAction,
  writeAltTextsAction,
} from "./actions";

export const metadata: Metadata = { title: "Media library" };

/**
 * The store's media library (D88): every picture and video uploaded for it,
 * here or in any editor, with where each is used.
 */
export default async function MediaPage({ params, searchParams }: PageProps<"/admin/[store]/media">) {
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "website").mediaPage;
  return (
    <AdminTextScope texts={adminTexts(lang, ["website"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={fillWords(w.description, { store: store.name })} />
      {/* The search in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-card" />}>
        <Library storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
    </AdminTextScope>
  );
}

async function Library({ storeSlug, searchParams }: { storeSlug: string; searchParams: PageProps<"/admin/[store]/media">["searchParams"] }) {
  const { store } = await requirePermission(storeSlug, "website:read");
  const query = mediaQuery(await searchParams);
  const owner = { storeId: store.id, storeSlug: store.slug };
  const [{ items, total, searched }, ai, site, altMissing, waiting] = await Promise.all([
    listMedia(owner, query),
    aiFor(store.id),
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
      basePath={`/admin/${store.slug}/media`}
      pictures={{
        make: ai?.image && uploadsEnabled() ? `/admin/${store.slug}/media/make` : null,
        edit: ai?.image?.editModel && uploadsEnabled() ? `/admin/${store.slug}/media/edit` : null,
        settingsHref: `/admin/${store.slug}/settings/ai`,
      }}
      upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
      startVideo={uploadsEnabled() ? startVideoUploadAction.bind(null, store.slug) : null}
      actions={{
        describe: describeMediaAction.bind(null, store.slug),
        writeAlt: writeAltTextAction.bind(null, store.slug),
        writeAlts: writeAltTextsAction.bind(null, store.slug),
        remove: deleteMediaAction.bind(null, store.slug),
        removeMany: deleteManyMediaAction.bind(null, store.slug),
        measure: measureMediaAction.bind(null, store.slug),
      }}
      languages={site?.languages ?? []}
      altAi={Boolean(ai?.textModel) && Boolean(site)}
      altMissing={altMissing}
      compress={
        uploadsEnabled()
          ? {
              picture: compressPictureAction.bind(null, store.slug),
              startVideo: startCompressedVideoAction.bind(null, store.slug),
              finishVideo: finishCompressedVideoAction.bind(null, store.slug),
              waiting: compressibleMediaAction.bind(null, store.slug),
            }
          : null
      }
      waiting={waiting}
    />
  );
}
