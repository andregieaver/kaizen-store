import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { pageInput } from "@/lib/page-content";
import { frameDraft } from "@/server/replicate-store";
import { getStore } from "@/server/stores";

export const metadata: Metadata = { title: "Copy being measured", robots: { index: false, follow: false } };

/**
 * The draft of a page being copied (D150), drawn as the store's pages are but without the admin around it, for the browser
 * that photographs and measures it (`openCopy()`). It is not behind a sign-in, as that browser has none: the address
 * carries a token made for this job that opens this job's draft for forty minutes, and nothing else. The page is painted with
 * the original's own colour, which shows between its rows as it did on the original.
 */
export default function ReplicaFramePage({ params, searchParams }: PageProps<"/admin/account/replica/[jobId]">) {
  // It reads the address and the database: shown as they arrive, never prerendered.
  return (
    <Suspense fallback={null}>
      <ReplicaFrame params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReplicaFrame({ params, searchParams }: Pick<PageProps<"/admin/account/replica/[jobId]">, "params" | "searchParams">) {
  const { jobId } = await params;
  const query = await searchParams;
  const token = typeof query.t === "string" ? query.t : undefined;
  if (!/^[0-9a-f-]{36}$/.test(jobId)) notFound();
  const draft = await frameDraft(jobId, token);
  if (!draft) notFound();
  const [store, content] = [await getStore(draft.storeSlug), pageInput.safeParse(draft.draft)];
  if (!store || !content.success) notFound();
  const background = draft.background && /^#[0-9a-f]{6}$/i.test(draft.background) ? draft.background : "#ffffff";
  return (
    <div data-replica-frame="" style={{ background }} className="min-h-screen">
      {/* The store's own page colour would show between rows; the original's does. */}
      <style>{`[data-replica-frame] [data-theme-canvas]{background:transparent!important}[data-replica-frame] [data-site-css]{gap:0!important}`}</style>
      <PageDrawing themed store={store} type="page" id={draft.pageId} content={content.data} publishedAt={null} />
    </div>
  );
}
