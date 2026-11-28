"use client";

import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { NavIcon, type NavIconName } from "./nav-icons";
import { AdminLink } from "./ui/link";
import { PageHeader } from "./ui/page-header";
import { CARD_CLASS } from "./ui/card";

export type SettingState = { tone: "positive" | "warning" | "neutral"; text: string };
export type SettingCard = { href: string; label: string; icon?: NavIconName; state?: SettingState; hint?: string; words?: string };
export type SettingGroup = { heading: string; items: SettingCard[] };

export type SettingsHubWords = { find: string; findPlaceholder: string; progressSub: string; everythingElse: string; everythingElseSub: string; show: string; hide: string };

/**
 * The settings hub (round 2, D597): settings grouped by what an owner is doing, each card saying where it stands (set up, needs you, or just
 * what it holds), a strip of how far the essentials are with the next fix as the page's one green button, and every other setting listed
 * by name rather than hidden. A search filters every card and name at once. Drawn by a store's Settings and by Kaizena Flow's own.
 */
/** On a phone, the group's list is the card (round 23); from 640 px each tile is its own. */
const PHONE_CARD = "max-sm:rounded-card max-sm:bg-card max-sm:dark:border max-sm:dark:border-line";

export function SettingsHub({
  title,
  lead,
  progress,
  groups,
  rest,
  words: w,
}: {
  title: string;
  lead: string;
  progress: { done: number; total: number; label: string; next: { href: string; label: string } | null } | null;
  groups: SettingGroup[];
  rest: SettingCard[];
  words: SettingsHubWords;
}) {
  const [query, setQuery] = useState("");
  /** On a phone (round 39, D731) the other settings wait behind one row, the search finding them all the same. */
  const [restOpen, setRestOpen] = useState(false);
  const q = query.trim().toLocaleLowerCase();
  const hit = (card: SettingCard) => !q || `${card.label} ${card.words ?? ""} ${card.hint ?? ""}`.toLocaleLowerCase().includes(q);
  const shownGroups = useMemo(() => groups.map((g) => ({ ...g, items: g.items.filter(hit) })).filter((g) => g.items.length > 0), [groups, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownRest = rest.filter(hit);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description={<p className="text-body-lg text-pretty">{lead}</p>}
        actions={
        <label className="flex h-11 w-full items-center gap-2.5 rounded-pill bg-card px-4 ring-1 ring-edge sm:w-80">
          <Search aria-hidden className="size-4 shrink-0 text-muted" />
          <span className="sr-only">{w.find}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={w.findPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        }
      />

      {progress && !q && (
        // On a phone (round 39, D731) the essentials are one line: how far, the bar under it, the next fix beside them.
        <section aria-label={progress.label} className={`${CARD_CLASS} flex flex-wrap items-center gap-x-8 gap-y-4 p-5 sm:px-6 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-4 max-sm:py-3`}>
          <div className="flex min-w-48 flex-col gap-1 max-sm:min-w-0">
            <span className="text-metric text-ink max-sm:text-body">{progress.label}</span>
            <span className="text-caption text-muted max-sm:hidden">{w.progressSub}</span>
          </div>
          <div role="img" aria-label={progress.label} className="grid min-w-48 flex-[1_1_20rem] gap-1 max-sm:col-start-1 max-sm:min-w-0" style={{ gridTemplateColumns: `repeat(${Math.max(1, progress.total)}, minmax(0, 1fr))` }}>
            {Array.from({ length: progress.total }, (_, i) => (
              <span key={i} className={`h-2.5 rounded-[3px] max-sm:h-1.5 ${i < progress.done ? "bg-brand" : "bg-warning-solid"}`} />
            ))}
          </div>
          {progress.next && (
            <AdminLink href={progress.next.href} className="inline-flex h-11 items-center gap-2 rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1 max-sm:h-10 max-sm:max-w-44 max-sm:px-3.5 max-sm:text-caption max-sm:leading-tight">
              {progress.next.label} →
            </AdminLink>
          )}
        </section>
      )}

      {shownGroups.map((group) => (
        <section key={group.heading || "all"} aria-label={group.heading || title} className="flex flex-col gap-2.5">
          {group.heading && <h2 className="text-title text-ink max-sm:px-1 max-sm:text-body-strong max-sm:text-ink-2">{group.heading}</h2>}
          {/* Round 23 (D688): on a phone a group is one card of rows, not a card each; from 640 px the tiles are as before. */}
          <ul className={`grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] max-sm:gap-0 max-sm:divide-y max-sm:divide-line max-sm:px-4 ${PHONE_CARD}`}>
            {group.items.map((card) => {
              const warn = card.state?.tone === "warning";
              return (
                <li key={card.href}>
                  <AdminLink href={card.href} className={`sm:rounded-card sm:bg-card sm:dark:border sm:dark:border-line forced-colors:border flex h-full items-center gap-3.5 p-4.5 max-sm:min-h-16 max-sm:px-0 max-sm:py-3 sm:hover:ring-1 sm:hover:ring-edge ${warn ? "sm:ring-1 sm:ring-warning-line" : ""}`}>
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-pill ${warn ? "bg-warning-soft text-warning-text" : "bg-sunken text-ink-2"}`}>
                      {card.icon && <NavIcon name={card.icon} className="size-[18px]" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-body-lg text-ink">{card.label}</span>
                      {card.state ? (
                        <span className={`flex items-center gap-1.5 text-caption ${card.state.tone === "positive" ? "text-positive-text" : warn ? "text-warning-text" : "text-ink-2"}`}>
                          <span aria-hidden className={`size-1.5 shrink-0 rounded-pill ${card.state.tone === "positive" ? "bg-insight-solid" : warn ? "bg-warning-solid" : "bg-neutral-solid"}`} />
                          {card.state.text}
                        </span>
                      ) : (
                        card.hint && <span className="line-clamp-1 text-caption text-muted">{card.hint}</span>
                      )}
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </AdminLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {shownRest.length > 0 && (
        <section aria-label={w.everythingElse} className={`${CARD_CLASS} flex flex-col gap-3.5 p-5 sm:px-6 max-sm:gap-0 max-sm:px-4 max-sm:py-0`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 max-sm:hidden">
            <h2 className="text-body-strong text-ink">{w.everythingElse}</h2>
            <span className="text-caption text-muted">{w.everythingElseSub}</span>
          </div>
          {/* The phone's row; while searching, the names found show without it. */}
          {!q && (
            <button type="button" aria-expanded={restOpen} onClick={() => setRestOpen((open) => !open)} className="flex min-h-14 items-center justify-between gap-3 py-2 text-left sm:hidden">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body text-ink">{w.everythingElse}</span>
                <span className="text-caption text-ink-2">{w.everythingElseSub}</span>
              </span>
              <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{restOpen ? w.hide : w.show}</span>
            </button>
          )}
          <ul className={`flex flex-wrap gap-1.5 ${restOpen || q ? "max-sm:py-3" : "max-sm:hidden"}`}>
            {shownRest.map((card) => (
              <li key={card.href}>
                <AdminLink href={card.href} className="inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-sunken px-3 text-caption text-ink hover:bg-line">
                  {card.icon && <NavIcon name={card.icon} className="size-3.5 text-ink-2" />}
                  {card.label}
                </AdminLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
