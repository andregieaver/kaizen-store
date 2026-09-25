import Link from "next/link";

import type { PageState, PageSummary } from "@/server/pages";

const STATE_LABELS: Record<PageState, string> = {
  draft: "Draft",
  published: "Published",
  changed: "Published, draft has changes",
};

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

/**
 * An owner's pages (D42, D53): Kaizen's or a store's, each with its address,
 * whether it is on the site, and links to edit and view it.
 */
export function PagesTable({
  pages,
  adminBase,
  siteBase,
  frontPageId = null,
}: {
  pages: PageSummary[];
  adminBase: string;
  siteBase: string;
  /** A store's front page (D54), marked in the list. */
  frontPageId?: string | null;
}) {
  return (
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
                        <Link href={`${adminBase}/${page.id}`} className="font-medium underline">
                          {page.title || "Untitled"}
                        </Link>
                        <span className="block truncate text-muted">
                          {page.id === frontPageId ? `Front page · ${siteBase}` : `${siteBase}/${page.slug}`}
                        </span>
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
                    <Link href={`${adminBase}/${page.id}`} className="underline">
                      Edit<span className="sr-only"> {page.title}</span>
                    </Link>
                    {page.state !== "draft" && (
                      <>
                        {" · "}
                        <a href={`${siteBase}/${page.slug}`} target="_blank" rel="noopener" className="underline">
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
  );
}
