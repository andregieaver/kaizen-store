import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { PageType } from "@/lib/page-content";
import { requirePageTypeAccess } from "@/server/permissions";
import { testOfVersionPage } from "@/server/experiment-admin";
import { getPageForEdit } from "@/server/pages";
import { stagedCopy } from "@/server/site-staging";

import { storePagesBase } from "./context";
import { PageDrawing } from "./drawing";

/** A store's page preview (D53, D57), apart from its editors (`editor-views.tsx`): a route loads every client component its modules import (bloat review step 0.10). */

type PageParams = Promise<{ store: string; pageId: string }>;
type Query = Promise<Record<string, string | string[] | undefined>>;

/** The last saved draft of a store's page or article, as the store will show it once published. */
export async function StorePreviewPageView({
  type,
  params,
  searchParams,
}: {
  type: PageType;
  params: PageParams;
  /** A product layout's preview (D79): `product`, the product it is shown with. */
  searchParams?: Query;
}) {
  const { store: storeSlug, pageId } = await params;
  const gated = await requirePageTypeAccess(storeSlug, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store } = gated;
  const ew = adminText(adminLangOf(gated.account.adminLocale), "builder").editor;
  const found = z.uuid().safeParse(pageId).success ? await getPageForEdit(store.id, pageId, type) : null;
  if (!found) notFound();
  // `?staging=1`: the staging set's copy (D385), drawn in place of the page's own draft.
  const query = await searchParams;
  const staged = query?.staging === "1" ? await stagedCopy(store.id, found.id) : null;
  if (query?.staging === "1" && !staged) notFound();
  const page = staged ? { ...found, draft: staged.content } : found;
  const copy = PAGE_TYPE_COPY[type];
  // A version made for an A/B test (D148) is drawn as the kind of page it stands in for.
  const drawnAs: PageType = type === "variant" ? ((await testOfVersionPage(store.id, page.id))?.targetType ?? "page") : type;
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand px-4 py-3 text-sm text-brand-ink">
        <span>
          {staged ? "Preview of the staging set's copy. " : "Preview of the saved draft. "}
          {page.state === "draft"
            ? `The ${copy.one} is not in your store yet.`
            : page.state === "changed"
              ? "Your store still shows the published version."
              : "This is what your store shows."}
        </span>
        <Link href={`${storePagesBase(store, type)}/${page.id}${staged ? "?staging=1" : ""}`} className="font-medium underline">
          {ew.backToEditing}
        </Link>
      </p>
      <PageDrawing
        store={store}
        type={drawnAs}
        id={page.id}
        content={page.draft}
        publishedAt={page.publishedAt}
        asked={query?.product}
      />
    </div>
  );
}
