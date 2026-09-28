import type { Metadata } from "next";
import { Suspense } from "react";

import { MediaLibrary } from "@/components/admin/media-library";
import { mediaQuery } from "@/lib/media-query";
import { requireMember } from "@/server/auth";
import { aiFor } from "@/server/ai";
import { uploadsEnabled } from "@/server/media";
import { listMedia } from "@/server/media-library";

import { startVideoUploadAction, uploadImageAction } from "../products/actions";
import { deleteMediaAction, describeMediaAction, measureMediaAction } from "./actions";

export const metadata: Metadata = { title: "Media library" };

/**
 * The store's media library (D88): every picture and video uploaded for it,
 * here or in any editor, with where each is used.
 */
export default async function MediaPage({ params, searchParams }: PageProps<"/admin/[store]/media">) {
  const { store } = await requireMember((await params).store);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Media library</h1>
        <p className="max-w-2xl text-sm text-muted">
          Every picture and video {store.name} has uploaded, here or in any editor. Add many at once, find them by name
          or description, and see where each one is used before you delete it.
        </p>
      </div>
      {/* The search in the address is read per request. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-background" />}>
        <Library storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Library({ storeSlug, searchParams }: { storeSlug: string; searchParams: PageProps<"/admin/[store]/media">["searchParams"] }) {
  const { store } = await requireMember(storeSlug);
  const query = mediaQuery(await searchParams);
  const [{ items, total, searched }, ai] = await Promise.all([
    listMedia({ storeId: store.id, storeSlug: store.slug }, query),
    aiFor(store.id),
  ]);
  return (
    <MediaLibrary
      items={items}
      total={total}
      query={query}
      searched={searched}
      meaning={Boolean(ai?.space)}
      basePath={`/admin/${store.slug}/media`}
      upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
      startVideo={uploadsEnabled() ? startVideoUploadAction.bind(null, store.slug) : null}
      actions={{
        describe: describeMediaAction.bind(null, store.slug),
        remove: deleteMediaAction.bind(null, store.slug),
        measure: measureMediaAction.bind(null, store.slug),
      }}
    />
  );
}
