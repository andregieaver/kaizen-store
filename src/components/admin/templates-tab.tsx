"use client";

import { useEffect, useState } from "react";

import type { SavedPart } from "@/lib/saved-parts";
import {
  KIND_LABELS,
  TEMPLATE_SOURCES,
  TEMPLATE_SOURCE_LABELS,
  type TemplateActions,
  type TemplateItem,
  type TemplateSource,
} from "@/lib/templates";

import { activated, groupTemplates, noneActivated } from "./templates-helpers";
import type { TemplateController } from "./templates-lists";
import { EmptyState, Problems, Publisher, groupHeading } from "./templates-parts";

/**
 * The builder's Templates tab (D125): the templates this store has switched on, from its own stores or the marketplace,
 * to add to the page as copies, and a way into the modal that lists them all. Its lists come from `controller`, which the
 * modal shares, and are read when the tab is first shown.
 */
export function TemplatesTab({
  controller,
  actions,
  source,
  onSource,
  shown,
  onBrowse,
  onUse,
  rowsFull,
  blocksFull,
}: {
  controller: TemplateController;
  actions: TemplateActions;
  source: TemplateSource;
  onSource: (source: TemplateSource) => void;
  /** The tab is the one open, in a sidebar that is open. */
  shown: boolean;
  onBrowse: () => void;
  /** Puts a template's copy on the page, like a saved part. */
  onUse: (part: SavedPart) => void;
  rowsFull: boolean;
  blocksFull: boolean;
}) {
  const { load } = controller;
  useEffect(() => {
    if (shown) load(source);
  }, [shown, source, load]);

  const [using, setUsing] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const use = async (item: TemplateItem) => {
    setUsing(item.id);
    setIssues((current) => ({ ...current, [item.id]: [] }));
    try {
      const result = await actions.use(item.id);
      if (result.ok) onUse(result.part);
      else setIssues((current) => ({ ...current, [item.id]: result.problems }));
    } catch {
      setIssues((current) => ({ ...current, [item.id]: ["It could not be added. Try again."] }));
    }
    setUsing(null);
  };

  const list = controller.lists[source];
  const groups = groupTemplates(activated(list.items));
  const empty = noneActivated(source);

  return (
    <>
      <p className="text-xs text-muted">
        Templates you have switched on. Press Use to add a copy to the page: it is yours to change, and later edits by
        whoever shared it never reach it.
      </p>
      <div role="group" aria-label="Templates from" className="grid grid-cols-2 gap-1 rounded-md bg-surface p-1">
        {TEMPLATE_SOURCES.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={source === each}
            onClick={() => onSource(each)}
            className="min-h-9 rounded px-2 text-xs font-medium text-muted aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            {TEMPLATE_SOURCE_LABELS[each]}
          </button>
        ))}
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
        <p role="status" className="text-xs text-muted">
          Loading templates …
        </p>
      ) : groups.length === 0 ? (
        <EmptyState title={empty.title} hint={empty.hint} />
      ) : (
        groups.map((group) => (
          <section
            key={group.kind}
            aria-label={`Template ${group.label.toLowerCase()}`}
            className="flex flex-col gap-2"
          >
            <h3 className={groupHeading}>{group.label}</h3>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
                  <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm" title={item.name}>
                        {item.name}
                      </span>
                      {item.summary && <span className="text-xs text-muted">{item.summary}</span>}
                      <Publisher item={item} />
                    </div>
                    <button
                      type="button"
                      onClick={() => use(item)}
                      disabled={using !== null || (item.kind === "block" ? blocksFull : rowsFull)}
                      aria-label={`Use ${KIND_LABELS[item.kind].one.toLowerCase()} ${item.name}`}
                      className="min-h-9 shrink-0 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface disabled:opacity-50"
                    >
                      {using === item.id ? "Adding …" : "Use"}
                    </button>
                  </div>
                  <Problems problems={issues[item.id]} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <button
        type="button"
        onClick={onBrowse}
        className="min-h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-surface"
      >
        Browse templates
      </button>
    </>
  );
}
