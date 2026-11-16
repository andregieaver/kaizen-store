import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { testFrame } from "@/server/experiment-admin";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Version", robots: { index: false, follow: false } };

/**
 * One page of an A/B test drawn alone, for the side-by-side frames on the test's page (D148 phase 16, `docs/ab-testing-usability.md` step 2b):
 * the original as it is live, a version as visitors are shown it (its draft while the test is a draft). Outside the admin's frame, so the
 * frame holds only the page; signed in, with the A/B tests' own permission, and only for a page that is in one of the store's tests. The
 * site's headers say only Kaizena Flow may frame it.
 */
export default function TestFramePage({ params }: PageProps<"/admin/frame/[store]/[pageId]">) {
  // It reads the session and the database: drawn as they arrive, never prerendered.
  return (
    <Suspense fallback={null}>
      <TestFrame params={params} />
    </Suspense>
  );
}

async function TestFrame({ params }: Pick<PageProps<"/admin/frame/[store]/[pageId]">, "params">) {
  const { store: slug, pageId } = await params;
  const { store } = await requirePermission(slug, "marketing:read");
  if (!z.uuid().safeParse(pageId).success) notFound();
  const frame = await testFrame(store.id, pageId);
  if (!frame) notFound();
  return (
    <div data-test-frame="" className="min-h-screen bg-card">
      <PageDrawing themed store={store} type={frame.type} id={pageId} content={frame.content} publishedAt={frame.publishedAt} />
    </div>
  );
}
