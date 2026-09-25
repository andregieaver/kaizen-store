import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageArticle } from "@/components/page-article";
import { requireMember } from "@/server/auth";
import { getPageForEdit } from "@/server/pages";

import { storePagesBase } from "../../context";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/** The last saved draft of a store's page (D53), as the store will show it once published. */
export default async function PreviewStorePagePage({ params }: PageProps<"/admin/[store]/pages/[pageId]/preview">) {
  const { store: storeSlug, pageId } = await params;
  const { store } = await requireMember(storeSlug);
  const page = z.uuid().safeParse(pageId).success ? await getPageForEdit(store.id, pageId) : null;
  if (!page) notFound();
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background">
        <span>
          Preview of the saved draft.{" "}
          {page.state === "draft"
            ? "The page is not in your store yet."
            : page.state === "changed"
              ? "Your store still shows the published version."
              : "This is what your store shows."}
        </span>
        <Link href={`${storePagesBase(store)}/${page.id}`} className="font-medium underline">
          Back to editing
        </Link>
      </p>
      <PageArticle content={page.draft} place={{ pageId: page.id, owner: store.id, market: store.markets[0]?.code }} />
    </div>
  );
}
