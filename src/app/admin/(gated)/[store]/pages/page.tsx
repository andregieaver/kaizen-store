import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PagesTable } from "@/components/admin/pages-table";
import { marketPath } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { listPages } from "@/server/pages";

import { setFrontPageAction } from "./actions";
import { storePagesBase } from "./context";

export const metadata: Metadata = { title: "Pages" };

/** A store's pages (D53): built with the same page builder as Kaizen's, in the store's own look. */
export default async function StorePagesPage({ params, searchParams }: PageProps<"/admin/[store]/pages">) {
  const { store } = await requireMember((await params).store);
  const [pages, query] = await Promise.all([listPages(store.id), searchParams]);
  const base = storePagesBase(store);
  const market = store.markets[0];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pages</h1>
          <p className="max-w-2xl text-sm text-muted">
            Pages of your own, such as About us or Delivery, in every country your store sells to. Save a page as a
            draft while you work on it; publish it to put it in your store, and add it to your menus under Header and
            footer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/categories`} className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium">
            Categories and tags
          </Link>
          <Link
            href={`${base}/new`}
            className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
          >
            New page
          </Link>
        </div>
      </div>
      {query.deleted && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          The page was deleted.
        </p>
      )}
      {pages.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
          No pages yet. Make the first one with New page.
        </p>
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={market ? marketPath(store.slug, market.slug) : ""}
          frontPageId={store.frontPageId}
        />
      )}
      <FrontPageForm
        storeSlug={store.slug}
        current={store.frontPageId}
        pages={pages.filter((p) => p.state !== "draft" || p.id === store.frontPageId)}
      />
    </div>
  );
}

/**
 * Which page shoppers land on (D54): the product list, or one of the store's
 * published pages, in every country it sells to.
 */
function FrontPageForm({
  storeSlug,
  current,
  pages,
}: {
  storeSlug: string;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
}) {
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  return (
    <ActionForm
      action={setFrontPageAction.bind(null, storeSlug)}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5"
    >
      <h2 className="font-medium">Front page</h2>
      <p className="max-w-2xl text-sm text-muted">
        What shoppers see first in your store: your products, or one of your published pages (with a content grid of
        products, for instance).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          Your store opens with
          <select name="frontPage" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">
            <option value="">All products</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || "Untitled"}
                {page.state === "draft" ? " (not published)" : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>Save</SubmitButton>
      </div>
      {unpublished && (
        <p className="text-sm text-muted">
          This page is not published, so shoppers see your products until you publish it again.
        </p>
      )}
    </ActionForm>
  );
}
