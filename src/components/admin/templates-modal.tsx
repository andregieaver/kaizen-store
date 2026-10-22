"use client";

import { useEffect, useId, useState } from "react";

import type { PageType } from "@/lib/page-content";
import { fillWords } from "@/lib/admin-fill";
import { TEMPLATE_SOURCES, type TemplateItem, type TemplateSource } from "@/lib/templates";

import { useAdminText } from "./admin-text";

import { Modal } from "./modal";
import {
  kindFilters,
  NO_FILTERS,
  filterTemplates,
  fitsPage,
  groupTemplates,
  nothingShared,
  blockedReason,
  type KindFilter,
  type TemplateFilters,
} from "./templates-helpers";
import type { TemplateController } from "./templates-lists";
import { CardButtons, EmptyState, PageTypeBadge, Problems, Publisher, groupHeading } from "./templates-parts";
import type { TemplateUse } from "./templates-use";

/**
 * Every template a store may use (D125), by source, for switching on and off, previewing and using: the builder's
 * Templates tab shows only the ones that are on. Filters work in the browser on what was read: a kind, only the ones
 * that are on, and a search. It opens on `kind` (the builder's "Start from a page layout" opens it on page layouts, D127);
 * a page layout made for another kind of page is listed, marked, and cannot be used here.
 */
export function TemplatesModal({
  open,
  onClose,
  ...rest
}: {
  controller: TemplateController;
  use: TemplateUse;
  source: TemplateSource;
  onSource: (source: TemplateSource) => void;
  open: boolean;
  /** Kaizen's own builder (D236): one source, its own templates, always on. */
  own?: boolean;
  /** The kind the list starts on each time it opens. */
  kind?: KindFilter;
  onClose: () => void;
  onPreview: (item: TemplateItem, source: TemplateSource, opener: HTMLElement) => void;
  pageType: PageType;
  rowsFull: boolean;
  blocksFull: boolean;
}) {
  const w = useAdminText("builder").templates;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={w.title}
      wide
      footer={
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
        >
          {w.done}
        </button>
      }
    >
      {/* Drawn only while open, so each opening starts from its own filters. */}
      <Browser open={open} {...rest} />
    </Modal>
  );
}

function Browser({
  controller,
  use,
  source,
  onSource,
  open,
  kind = "all",
  onPreview,
  pageType,
  rowsFull,
  blocksFull,
  own = false,
}: Omit<Parameters<typeof TemplatesModal>[0], "onClose">) {
  const id = useId();
  const [filters, setFilters] = useState<TemplateFilters>({ ...NO_FILTERS, kind });
  const { load } = controller;
  useEffect(() => {
    if (open) load(source);
  }, [open, source, load]);

  const w = useAdminText("builder").templates;
  const list = controller.lists[source];
  const shown = groupTemplates(filterTemplates(list.items, filters), w);
  const select = (index: number) => {
    const next = TEMPLATE_SOURCES[(index + TEMPLATE_SOURCES.length) % TEMPLATE_SOURCES.length];
    onSource(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  const nothing = nothingShared(source, own, w);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={w.whereFrom} hidden={own} className="grid grid-cols-2 border-b border-line">
        {TEMPLATE_SOURCES.map((each, index) => (
          <button
            key={each}
            id={`${id}-${each}`}
            type="button"
            role="tab"
            aria-selected={source === each}
            aria-controls={`${id}-panel`}
            tabIndex={source === each ? 0 : -1}
            onClick={() => onSource(each)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") select(index + 1);
              if (event.key === "ArrowLeft") select(index - 1);
            }}
            className="min-h-11 border-b-2 border-transparent px-2 text-sm font-medium text-muted aria-selected:border-brand aria-selected:text-ink"
          >
            {w.sources[each]}
          </button>
        ))}
      </div>

      <div id={`${id}-panel`} role={own ? undefined : "tabpanel"} aria-labelledby={own ? undefined : `${id}-${source}`} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <label htmlFor={`${id}-search`} className="sr-only">
            {w.search}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder={w.searchPlaceholder}
            className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label={w.kindGroup} className="flex flex-wrap gap-2">
              {kindFilters(w).map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={filters.kind === chip.value}
                  onClick={() => setFilters({ ...filters, kind: chip.value })}
                  className="min-h-9 rounded-full border border-line px-3 text-xs aria-pressed:border-brand aria-pressed:bg-sunken aria-pressed:font-medium"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={filters.activeOnly}
                onChange={(event) => setFilters({ ...filters, activeOnly: event.target.checked })}
                className="size-5 shrink-0 accent-brand"
              />
              {w.activatedOnly}
            </label>
          </div>
        </div>

        {list.status === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger-text">
            <p>{list.problem}</p>
            <button
              type="button"
              onClick={() => load(source, true)}
              className="min-h-9 rounded-pill border border-edge px-3 text-xs text-ink"
            >
              {w.tryAgain}
            </button>
          </div>
        ) : list.status !== "ready" ? (
          <p role="status" className="text-sm text-muted">
            {w.loading}
          </p>
        ) : list.items.length === 0 ? (
          <EmptyState title={nothing.title} hint={nothing.hint} />
        ) : shown.length === 0 ? (
          <EmptyState title={w.noMatch.title} hint={w.noMatch.hint}>
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="min-h-9 rounded-pill border border-edge px-3 text-xs"
            >
              {w.clear}
            </button>
          </EmptyState>
        ) : (
          shown.map((group) => (
            <section
              key={group.kind}
              aria-label={fillWords(w.group, { kind: group.label.toLowerCase() })}
              className="flex flex-col gap-2"
            >
              <h3 className={groupHeading}>{group.label}</h3>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => {
                  const reason = blockedReason(item, { pageType, rowsFull, blocksFull }, w);
                  return (
                    <li key={item.id} className="flex flex-col gap-1 rounded-md border border-line p-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{item.name}</span>
                            <PageTypeBadge item={item} warn={!fitsPage(item, pageType)} />
                            {item.active && !own && (
                              <span className="rounded-full bg-sunken px-1.5 py-px text-[11px] leading-4 text-muted">
                                {w.activated}
                              </span>
                            )}
                          </span>
                          {item.summary && <span className="text-xs text-muted">{item.summary}</span>}
                          <Publisher item={item} />
                        </div>
                        <CardButtons
                          item={item}
                          reason={reason}
                          using={use.using === item.id}
                          disabled={use.using !== null}
                          onPreview={(opener) => onPreview(item, source, opener)}
                          onUse={() => use.run(item)}
                        >
                          <button
                            type="button"
                            hidden={own}
                            onClick={() => controller.setActive(source, item.id, !item.active)}
                            disabled={controller.busy.has(item.id)}
                            aria-label={fillWords(item.active ? w.deactivateLabel : w.activateLabel, { name: item.name })}
                            className={`min-h-9 shrink-0 rounded-pill px-3 text-xs font-medium disabled:opacity-50 ${
                              item.active ? "border border-edge hover:bg-sunken" : "bg-brand text-brand-ink"
                            }`}
                          >
                            {item.active ? w.deactivate : w.activate}
                          </button>
                        </CardButtons>
                      </div>
                      <Problems problems={[...(controller.problems[item.id] ?? []), ...(use.issues[item.id] ?? [])]} />
                      {use.added === item.id && (
                        <p role="status" className="text-xs text-muted">
                          {w.added}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
