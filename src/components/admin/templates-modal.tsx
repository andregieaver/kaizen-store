"use client";

import { useEffect, useId, useState } from "react";

import { TEMPLATE_SOURCES, TEMPLATE_SOURCE_LABELS, type TemplateSource } from "@/lib/templates";

import { Modal } from "./modal";
import {
  KIND_FILTERS,
  NO_FILTERS,
  filterTemplates,
  groupTemplates,
  nothingShared,
  type TemplateFilters,
} from "./templates-helpers";
import type { TemplateController } from "./templates-lists";
import { EmptyState, Problems, Publisher, groupHeading } from "./templates-parts";

/**
 * Every template a store may use (D125), by source, for switching on and off: the builder's Templates tab shows only the
 * ones that are on. Filters work in the browser on what was read: a kind, only the ones that are on, and a search.
 */
export function TemplatesModal({
  controller,
  source,
  onSource,
  open,
  onClose,
}: {
  controller: TemplateController;
  source: TemplateSource;
  onSource: (source: TemplateSource) => void;
  open: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const [filters, setFilters] = useState<TemplateFilters>(NO_FILTERS);
  const { load } = controller;
  useEffect(() => {
    if (open) load(source);
  }, [open, source, load]);

  const list = controller.lists[source];
  const shown = groupTemplates(filterTemplates(list.items, filters));
  const select = (index: number) => {
    const next = TEMPLATE_SOURCES[(index + TEMPLATE_SOURCES.length) % TEMPLATE_SOURCES.length];
    onSource(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  const nothing = nothingShared(source);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Templates"
      wide
      footer={
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background"
        >
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label="Where templates come from" className="grid grid-cols-2 border-b border-border">
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
              className="min-h-11 border-b-2 border-transparent px-2 text-sm font-medium text-muted aria-selected:border-foreground aria-selected:text-foreground"
            >
              {TEMPLATE_SOURCE_LABELS[each]}
            </button>
          ))}
        </div>

        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${source}`} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <label htmlFor={`${id}-search`} className="sr-only">
              Search templates
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              placeholder="Search by name, publisher or what is in it"
              className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
                {KIND_FILTERS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={filters.kind === chip.value}
                    onClick={() => setFilters({ ...filters, kind: chip.value })}
                    className="min-h-9 rounded-full border border-border px-3 text-xs aria-pressed:border-foreground aria-pressed:bg-surface aria-pressed:font-medium"
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
                  className="size-5 shrink-0 accent-foreground"
                />
                Activated only
              </label>
            </div>
          </div>

          {list.status === "error" ? (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm text-red-700 dark:text-red-400">
              <p>{list.problem}</p>
              <button
                type="button"
                onClick={() => load(source, true)}
                className="min-h-9 rounded-md border border-border px-3 text-xs text-foreground"
              >
                Try again
              </button>
            </div>
          ) : list.status !== "ready" ? (
            <p role="status" className="text-sm text-muted">
              Loading templates …
            </p>
          ) : list.items.length === 0 ? (
            <EmptyState title={nothing.title} hint={nothing.hint} />
          ) : shown.length === 0 ? (
            <EmptyState title="No templates match" hint="Try another search, or take a filter off.">
              <button
                type="button"
                onClick={() => setFilters(NO_FILTERS)}
                className="min-h-9 rounded-md border border-border px-3 text-xs"
              >
                Clear filters
              </button>
            </EmptyState>
          ) : (
            shown.map((group) => (
              <section
                key={group.kind}
                aria-label={`Template ${group.label.toLowerCase()}`}
                className="flex flex-col gap-2"
              >
                <h3 className={groupHeading}>{group.label}</h3>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <li key={item.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{item.name}</span>
                            {item.active && (
                              <span className="rounded-full bg-surface px-1.5 py-px text-[11px] leading-4 text-muted">
                                Activated
                              </span>
                            )}
                          </span>
                          {item.summary && <span className="text-xs text-muted">{item.summary}</span>}
                          <Publisher item={item} />
                        </div>
                        <button
                          type="button"
                          onClick={() => controller.setActive(source, item.id, !item.active)}
                          disabled={controller.busy.has(item.id)}
                          aria-label={`${item.active ? "Deactivate" : "Activate"} ${item.name}`}
                          className={`min-h-9 shrink-0 rounded-md px-3 text-xs font-medium disabled:opacity-50 ${
                            item.active ? "border border-border hover:bg-surface" : "bg-foreground text-background"
                          }`}
                        >
                          {item.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                      <Problems problems={controller.problems[item.id]} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
