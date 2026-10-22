"use client";

import type { PageSummary } from "@/server/pages";
import type { DuplicateResult } from "@/lib/page-duplicate";
import { ROLE_COPY, type PageRole } from "@/lib/page-roles";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";

import { useAdminLang, useAdminText } from "./admin-text";

import { DuplicateButton } from "./duplicate-button";
import { buttonClass, ButtonLink, Card, Chip, List, ListRow, RowActions, RowFact, RowLead } from "@/components/admin/ui";


/** Where a page is on the site: its own address, or the place's it was chosen for (empty where the place has none, such as the 404 page). */
const viewPath = (slug: string, place: { address: string } | undefined) => (place ? place.address : `/${slug}`);

/**
 * An owner's pages (D42, D53): Kaizen's or a store's, each with its address,
 * whether it is on the site, and links to edit and view it.
 */
export function PagesTable({
  pages,
  adminBase,
  siteBase,
  frontPageId = null,
  productsPageId = null,
  roles = {},
  placed = {},
  duplicate,
}: {
  pages: PageSummary[];
  adminBase: string;
  siteBase: string;
  /** A store's front page (D54), marked in the list. */
  frontPageId?: string | null;
  /** A store's All products page (D83), marked in the list. */
  productsPageId?: string | null;
  /** The pages chosen for the blog, search and 404 places (D112), by page id. */
  roles?: Record<string, PageRole>;
  /** Kaizen's pages with a place of their own (D143), by page id: the place's name and address, which the page is at instead of its own. */
  placed?: Record<string, { name: string; address: string }>;
  /** Makes a copy as a draft (D126), bound to the owner and kind of page; without it the list offers no Duplicate. */
  duplicate?: (id: string) => Promise<DuplicateResult>;
}) {
  const w = useAdminText("website").list;
  const date = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[useAdminLang()].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
        <Card compact>
          <List label={w.pages}>
            {pages.map((page) => (
              <ListRow key={page.id}>
                <RowLead
                  avatar={
                    page.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a small admin thumbnail
                      <img src={page.thumbnail} alt="" className="size-10 shrink-0 rounded object-cover" />
                    ) : (
                      <span aria-hidden className="size-10 shrink-0 rounded bg-sunken" />
                    )
                  }
                  title={page.title || w.untitled}
                  href={`${adminBase}/${page.id}`}
                  sub={
                    <span className="block truncate">
                      {page.id === frontPageId
                        ? fillWords(w.frontPage, { address: siteBase })
                        : page.id === productsPageId
                          ? fillWords(w.productsPage, { address: `${siteBase}/products` })
                          : placed[page.id]
                            ? `${placed[page.id].name}${placed[page.id].address ? ` · ${siteBase}${placed[page.id].address}` : ""}`
                            : roles[page.id]
                              ? `${w.roles[roles[page.id]]}${ROLE_COPY[roles[page.id]].address ? ` · ${siteBase}${ROLE_COPY[roles[page.id]].address}` : ""}`
                              : `${siteBase}/${page.slug}`}
                    </span>
                  }
                />
                <RowFact className="hidden md:block" sub={`${page.searchEngines ? w.searchListed : w.searchNotListed} · ${page.aiAssistants ? w.aiOpen : w.aiClosed}`}>
                  {fillWords(w.changed, { date: date.format(new Date(page.updatedAt)) })}
                </RowFact>
                <Chip signal={page.state === "draft" ? "neutral" : page.state === "changed" ? "warning" : "positive"} dot>
                  {w.states[page.state]}
                </Chip>
                <RowActions>
                  <ButtonLink href={`${adminBase}/${page.id}`} kind="quiet" size="dense">
                    {w.edit}<span className="sr-only"> {page.title}</span>
                  </ButtonLink>
                  {page.state !== "draft" && viewPath(page.slug, placed[page.id]) !== "" && (
                    <a href={`${siteBase}${viewPath(page.slug, placed[page.id])}`} target="_blank" rel="noopener" className={buttonClass("quiet", "dense")}>
                      {w.view}<span className="sr-only"> {page.title}</span>
                    </a>
                  )}
                  {duplicate && <DuplicateButton id={page.id} title={page.title} adminBase={adminBase} duplicate={duplicate} />}
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
  );
}
