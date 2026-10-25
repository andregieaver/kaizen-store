import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { pageInput } from "@/lib/page-content";
import { lookDraft } from "@/server/page-looks";
import { getStore } from "@/server/stores";

export const metadata: Metadata = { title: "Page being looked at", robots: { index: false, follow: false } };

/**
 * A page's draft (D310, `docs/ai-autopilot.md` 9.1), drawn as the store's site will draw it but without the admin around it, for the browser
 * that photographs it (`src/server/page-look-runner.ts`). It is not behind a sign-in, as that browser has none: the address carries a token
 * made for this page that opens its draft for ten minutes, and nothing else.
 */
export default function LookFramePage({ params, searchParams }: PageProps<"/admin/account/look/[pageId]">) {
  // It reads the address and the database: shown as they arrive, never prerendered.
  return (
    <Suspense fallback={null}>
      <LookFrame params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function LookFrame({ params, searchParams }: Pick<PageProps<"/admin/account/look/[pageId]">, "params" | "searchParams">) {
  const { pageId } = await params;
  const query = await searchParams;
  const token = typeof query.t === "string" ? query.t : undefined;
  const draft = await lookDraft(pageId, token);
  if (!draft) notFound();
  const [store, content] = [await getStore(draft.storeSlug), pageInput.safeParse(draft.draft)];
  if (!store || !content.success) notFound();
  return (
    <div data-look-frame="" className="min-h-screen">
      <PageDrawing themed store={store} type={draft.type} id={pageId} content={content.data} publishedAt={null} />
    </div>
  );
}
