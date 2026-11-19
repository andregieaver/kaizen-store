"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";

import type { PageSummary } from "@/server/pages";
import { adminDate } from "@/lib/admin-date";
import type { DuplicateResult } from "@/lib/page-duplicate";
import type { PageRole } from "@/lib/page-role-copy";
import { fillWords } from "@/lib/admin-fill";
import type { ScheduleChip } from "@/lib/page-schedules";

import { useAdminLang, useAdminText } from "./admin-text";
import { DuplicateButton } from "./duplicate-button";
import { PhoneMore } from "./phone-more";
import { PHONE_MORE_HIDDEN } from "./phone-more-class";
import { ScheduleChipView } from "./pages-table";
import { AdminLink, buttonClass, CARD_CLASS, Chip } from "@/components/admin/ui";

/** How many pages a phone shows before Show all (round 33, D707). */
const PHONE_FIRST = 10;

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
  timeZone,
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
  /** The time zone its dates are read in: the store's, or the platform's on Kaizena Flow's own pages (D786). */
  timeZone: string;
}) {
  const w = useAdminText("website");
  const list = w.list;
  const c = w.storePages.cards;
  const lang = useAdminLang();
  // Round 28 (D701): on a phone the pages are one card of lines, with a search once there are more than a screen of them.
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle ? pages.filter((page) => `${page.title} ${page.slug}`.toLowerCase().includes(needle)) : pages;
  // Round 33 (D707): a phone shows the first ten, then Show all; a search shows every match.
  const kept = needle ? 0 : Math.max(0, shown.length - PHONE_FIRST);
  return (
    <PhoneMore hidden={kept} label={fillWords(c.phone.showAll, { n: shown.length })} className="flex flex-col gap-3">
    {pages.length > 8 && (
      <label className="sm:hidden">
        <span className="sr-only">{c.find}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={c.find}
          className="min-h-11 w-full rounded-pill border border-line bg-card px-4 text-body"
        />
      </label>
    )}
    <ul
      aria-label={label ?? c.label}
      className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-4 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-card max-sm:bg-card"
    >
      {shown.map((page, n) => {
        const title = page.title || list.untitled;
        const href = `${adminBase}/${page.id}`;
        const place = page.id === frontPageId ? w.storePages.front.title : page.id === productsPageId ? w.storePages.front.all : roles[page.id] ? list.roles[roles[page.id]] : null;
        const address = page.id === frontPageId ? "" : page.id === productsPageId ? "/products" : `/${page.slug}`;
        return (
          <li
            key={page.id}
            className={`flex flex-col overflow-hidden ${CARD_CLASS} max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:rounded-none max-sm:border-b max-sm:border-line max-sm:pl-4 max-sm:last:border-b-0 ${n >= PHONE_FIRST && kept > 0 ? PHONE_MORE_HIDDEN : ""}`}
          >
            {/* Round 33 (D707): on a phone a page without a picture has no empty square. */}
            <AdminLink href={href} tabIndex={-1} aria-hidden className={`block aspect-[16/10] overflow-hidden bg-sunken max-sm:aspect-square max-sm:size-11 max-sm:shrink-0 max-sm:rounded-md ${page.thumbnail ? "" : "max-sm:hidden"}`}>
              {page.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- a page's own picture, small
                <img src={page.thumbnail} alt="" className="size-full object-cover object-top" />
              ) : (
                <span className="flex size-full items-center justify-center px-4 text-center text-2xl tracking-tight text-muted max-sm:hidden">{title}</span>
              )}
            </AdminLink>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3.5 max-sm:gap-1 max-sm:py-2.5 max-sm:pl-0 max-sm:pr-2">
              <span className="flex items-center justify-between gap-2">
                <AdminLink href={href} className="min-w-0 truncate text-body text-ink underline-offset-2 hover:underline">
                  {title}
                </AdminLink>
                {place && (
                  <span className="max-sm:hidden">
                    <Chip signal="insight">{place}</Chip>
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 max-sm:flex-nowrap">
                <span className="min-w-0 max-sm:hidden">
                  <Chip signal={page.state === "draft" ? "neutral" : page.state === "changed" ? "warning" : "positive"} dot>
                    {list.states[page.state]}
                  </Chip>
                </span>
                {/* Round 33 (D707): on a phone the state, its place in the shop and the day as one line of words, never cut off. */}
                <span className={`min-w-0 text-caption sm:hidden ${page.state === "draft" ? "text-ink-2" : page.state === "changed" ? "text-warning-text" : "text-positive-text"}`}>
                  {[list.states[page.state], place, adminDate(timeZone, page.updatedAt, "short", lang)].filter(Boolean).join(" · ")}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-caption text-muted max-sm:hidden">{adminDate(timeZone, page.updatedAt, "day", lang)}</span>
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
      <li className="max-sm:hidden">
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
    {needle && shown.length === 0 && <p className="text-sm text-muted sm:hidden">{c.noneFound}</p>}
    </PhoneMore>
  );
}
