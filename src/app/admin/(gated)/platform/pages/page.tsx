import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { requirePlatformAdmin } from "@/server/auth";
import { listPages, type PageState } from "@/server/pages";

export const metadata: Metadata = { title: "Pages" };

const STATE_LABELS: Record<PageState, string> = {
  draft: "Draft",
  published: "Published",
  changed: "Published, draft has changes",
};

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

/** Kaizen's own pages (D42): every page, its address and whether it is on the site. */
export default async function PagesPage({ searchParams }: PageProps<"/admin/platform/pages">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [pages, query] = await Promise.all([listPages(), searchParams]);
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
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="px-4 py-2 font-normal">
                  Page
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  Search · AI
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  Changed
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      {page.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a small admin thumbnail
                        <img src={page.thumbnail} alt="" className="size-10 shrink-0 rounded object-cover" />
                      ) : (
                        <span aria-hidden className="size-10 shrink-0 rounded bg-surface" />
                      )}
                      <span className="min-w-0">
                        <Link href={`/admin/platform/pages/${page.id}`} className="font-medium underline">
                          {page.title || "Untitled"}
                        </Link>
                        <span className="block truncate text-muted">/{page.slug}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {STATE_LABELS[page.state]}
                    {page.publishedAt && (
                      <span className="block text-muted">Published {date.format(new Date(page.publishedAt))}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {page.searchEngines ? "Listed" : "Not listed"} · {page.aiAssistants ? "Open" : "Closed"}
                  </td>
                  <td className="px-4 py-2 text-muted">{date.format(new Date(page.updatedAt))}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Link href={`/admin/platform/pages/${page.id}`} className="underline">
                      Edit<span className="sr-only"> {page.title}</span>
                    </Link>
                    {page.state !== "draft" && (
                      <>
                        {" · "}
                        <a href={`/${page.slug}`} target="_blank" rel="noopener" className="underline">
                          View<span className="sr-only"> {page.title}</span>
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
