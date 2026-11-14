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

export type SettingsHubWords = { find: string; findPlaceholder: string; progressSub: string; everythingElse: string; everythingElseSub: string };

/**
 * The settings hub (round 2, D597): settings grouped by what an owner is doing, each card saying where it stands (set up, needs you, or just
 * what it holds), a strip of how far the essentials are with the next fix as the page's one green button, and every other setting listed
 * by name rather than hidden. A search filters every card and name at once. Drawn by a store's Settings and by Kaizena Flow's own.
 */
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
        <section aria-label={progress.label} className={`${CARD_CLASS} flex flex-wrap items-center gap-x-8 gap-y-4 p-5 sm:px-6`}>
          <div className="flex min-w-48 flex-col gap-1">
            <span className="text-metric text-ink">{progress.label}</span>
            <span className="text-caption text-muted">{w.progressSub}</span>
          </div>
          <div role="img" aria-label={progress.label} className="grid min-w-48 flex-[1_1_20rem] gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, progress.total)}, minmax(0, 1fr))` }}>
            {Array.from({ length: progress.total }, (_, i) => (
              <span key={i} className={`h-2.5 rounded-[3px] ${i < progress.done ? "bg-brand" : "bg-warning-solid"}`} />
            ))}
          </div>
          {progress.next && (
            <AdminLink href={progress.next.href} className="inline-flex h-11 items-center gap-2 rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
              {progress.next.label} →
            </AdminLink>
          )}
        </section>
      )}

      {shownGroups.map((group) => (
        <section key={group.heading || "all"} aria-label={group.heading || title} className="flex flex-col gap-2.5">
          {group.heading && <h2 className="text-title text-ink">{group.heading}</h2>}
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
            {group.items.map((card) => {
              const warn = card.state?.tone === "warning";
              return (
                <li key={card.href}>
                  <AdminLink href={card.href} className={`${CARD_CLASS} flex h-full items-center gap-3.5 p-4.5 hover:ring-1 hover:ring-edge ${warn ? "ring-1 ring-warning-line" : ""}`}>
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
        <section aria-label={w.everythingElse} className={`${CARD_CLASS} flex flex-col gap-3.5 p-5 sm:px-6`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-body-strong text-ink">{w.everythingElse}</h2>
            <span className="text-caption text-muted">{w.everythingElseSub}</span>
          </div>
          <ul className="flex flex-wrap gap-1.5">
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
