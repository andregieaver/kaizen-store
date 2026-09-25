import type { Metadata } from "next";
import Link from "next/link";

import { TermsManager } from "@/components/admin/terms";
import { requireMember } from "@/server/auth";
import { listTerms } from "@/server/taxonomy";

import { createStorePageTermAction, deleteStorePageTermAction, updateStorePageTermAction } from "../actions";
import { storePagesBase } from "../context";

export const metadata: Metadata = { title: "Page categories and tags" };

/** A store's page categories and tags (D50, D53): chosen on each page, shown by content grids. */
export default async function StorePageTermsPage({ params }: PageProps<"/admin/[store]/pages/categories">) {
  const { store } = await requireMember((await params).store);
  const terms = await listTerms({ storeId: store.id, contentType: "page" });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={storePagesBase(store)} className="w-fit text-sm underline">
          Pages
        </Link>
        <h1 className="text-2xl font-semibold">Page categories and tags</h1>
        <p className="max-w-2xl text-sm text-muted">
          Sort your pages into categories and label them with tags; a content grid can then show the pages of a
          category or tag. Product categories are under Products.
        </p>
      </div>
      <TermsManager
        initial={terms}
        usedBy="pages"
        actions={{
          create: createStorePageTermAction.bind(null, store.slug),
          update: updateStorePageTermAction.bind(null, store.slug),
          remove: deleteStorePageTermAction.bind(null, store.slug),
        }}
      />
    </div>
  );
}
