"use client";

import { MoreHorizontal, Plus } from "lucide-react";

import type { PageSummary } from "@/server/pages";
import type { DuplicateResult } from "@/lib/page-duplicate";
import type { PageRole } from "@/lib/page-role-copy";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import type { ScheduleChip } from "@/lib/page-schedules";

import { useAdminLang, useAdminText } from "./admin-text";
import { DuplicateButton } from "./duplicate-button";
import { ScheduleChipView } from "./pages-table";
import { AdminLink, buttonClass, CARD_CLASS, Chip } from "@/components/admin/ui";

/**
 * A store's own pages as cards with a picture (D615, round 5 of the admin redesign): the page's picture or its name in large type,
 * what it is to the shop (front page, All products, a special page), whether it is live and when it changed, and a small menu with
 * View and Duplicate; the last card makes a new page. The same facts as `PagesTable`, which the other kinds of page keep.
 */
export function PageCards({
  pages,
  adminBase,
  siteBase,
  frontPageId = null,
  productsPageId = null,
  roles = {},
  schedules = {},
  duplicate,
  label,
  newLabel,
  newSub,
}: {
  pages: PageSummary[];
  adminBase: string;
  siteBase: string;
  frontPageId?: string | null;
  productsPageId?: string | null;
  roles?: Record<string, PageRole>;
  schedules?: Record<string, ScheduleChip>;
  duplicate?: (id: string) => Promise<DuplicateResult>;
  /** Another kind of page (the blog's articles, round 9): the list's name and the new card's words. */
  label?: string;
  newLabel?: string;
  newSub?: string;
}) {
  const w = useAdminText("website");
  const list = w.list;
  const c = w.storePages.cards;
  const date = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[useAdminLang()].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  return (
    <ul aria-label={label ?? c.label} className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-4">
      {pages.map((page) => {
        const title = page.title || list.untitled;
        const href = `${adminBase}/${page.id}`;
        const place = page.id === frontPageId ? w.storePages.front.title : page.id === productsPageId ? w.storePages.front.all : roles[page.id] ? list.roles[roles[page.id]] : null;
        const address = page.id === frontPageId ? "" : page.id === productsPageId ? "/products" : `/${page.slug}`;
        return (
          <li key={page.id} className={`flex flex-col overflow-hidden ${CARD_CLASS}`}>
            <AdminLink href={href} tabIndex={-1} aria-hidden className="block aspect-[16/10] overflow-hidden bg-sunken">
              {page.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- a page's own picture, small
                <img src={page.thumbnail} alt="" className="size-full object-cover object-top" />
              ) : (
                <span className="flex size-full items-center justify-center px-4 text-center text-2xl tracking-tight text-muted">{title}</span>
              )}
            </AdminLink>
            <div className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
              <span className="flex items-center justify-between gap-2">
                <AdminLink href={href} className="min-w-0 truncate text-body text-ink underline-offset-2 hover:underline">
                  {title}
                </AdminLink>
                {place && <Chip signal="insight">{place}</Chip>}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <Chip signal={page.state === "draft" ? "neutral" : page.state === "changed" ? "warning" : "positive"} dot>
                  {list.states[page.state]}
                </Chip>
                <span className="flex items-center gap-1">
                  <span className="text-caption text-muted">{date.format(new Date(page.updatedAt))}</span>
                  <details className="relative">
                    <summary
                      aria-label={fillWords(c.moreFor, { title })}
                      className="flex size-9 cursor-pointer list-none items-center justify-center rounded-pill text-ink-2 hover:bg-sunken [&::-webkit-details-marker]:hidden"
                    >
                      <MoreHorizontal aria-hidden className="size-4" />
                    </summary>
                    <div className="absolute right-0 bottom-full z-30 mb-1 flex w-56 flex-col items-stretch gap-1 rounded-panel border border-line bg-card p-2 shadow-[var(--shadow-float)] [&>*]:w-full">
                      <AdminLink href={href} className={buttonClass("quiet", "dense")}>
                        {list.edit}
                        <span className="sr-only"> {title}</span>
                      </AdminLink>
                      {page.state !== "draft" && (
                        <a href={`${siteBase}${address}`} target="_blank" rel="noopener" className={buttonClass("quiet", "dense")}>
                          {list.view}
                          <span className="sr-only"> {title}</span>
                        </a>
                      )}
                      {duplicate && <DuplicateButton id={page.id} title={page.title} adminBase={adminBase} duplicate={duplicate} />}
                    </div>
                  </details>
                </span>
              </span>
              {schedules[page.id] && <ScheduleChipView chip={schedules[page.id]} />}
            </div>
          </li>
        );
      })}
      <li>
        <AdminLink
          href={`${adminBase}/new`}
          className="flex h-full min-h-56 flex-col items-center justify-center gap-1.5 rounded-card border-[1.5px] border-dashed border-edge text-body text-ink-2 hover:bg-card"
        >
          <span className="flex items-center gap-1.5">
            <Plus aria-hidden className="size-4" />
            {newLabel ?? w.storePages.types.page.new}
          </span>
          <span className="text-caption text-muted">{newSub ?? c.newSub}</span>
        </AdminLink>
      </li>
    </ul>
  );
}
