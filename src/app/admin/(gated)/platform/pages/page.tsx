import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { requirePlatformAdmin } from "@/server/auth";
import { PagesTable } from "@/components/admin/pages-table";
import { listPages } from "@/server/pages";

export const metadata: Metadata = { title: "Pages" };

/** Kaizen's own pages (D42): every page, its address and whether it is on the site. */
export default async function PagesPage({ searchParams }: PageProps<"/admin/platform/pages">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [pages, query] = await Promise.all([listPages(null), searchParams]);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pages</h1>
          <p className="max-w-2xl text-sm text-muted">
            Kaizen&apos;s own pages, each at its own address on the site, such as /about. Save a page as a draft
            while you work on it; publish it to put it on the site. Add pages to the menus under{" "}
            <Link href="/admin/platform/navigation" className="underline">
              Header and footer
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/platform/pages/categories"
            className="flex min-h-11 items-center rounded-md border border-border px-5 font-medium"
          >
            Categories and tags
          </Link>
          <Link
            href="/admin/platform/pages/new"
            className="flex min-h-11 items-center rounded-md bg-foreground px-5 font-medium text-background"
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
        <PagesTable pages={pages} adminBase="/admin/platform/pages" siteBase="" />
      )}
    </>
  );
}
