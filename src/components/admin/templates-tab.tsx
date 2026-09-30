"use client";

import { useEffect } from "react";

import type { PageType } from "@/lib/page-content";
import { TEMPLATE_SOURCES, TEMPLATE_SOURCE_LABELS, type TemplateItem, type TemplateSource } from "@/lib/templates";

import { forPage, groupTemplates, noneActivated, blockedReason } from "./templates-helpers";
import type { TemplateController } from "./templates-lists";
import { CardButtons, EmptyState, Problems, Publisher, groupHeading } from "./templates-parts";
import type { TemplateUse } from "./templates-use";

/**
 * The builder's Templates tab (D125): the templates this store has switched on, from its own stores or the marketplace,
 * to add to the page as copies, and a way into the modal that lists them all. Its lists come from `controller`, which the
 * modal shares, and are read when the tab is first shown. A page layout (D127) is offered only on the kind of page it is
 * made for; every card can be previewed first.
 */
export function TemplatesTab({
  controller,
  use,
  source,
  onSource,
  shown,
  onBrowse,
  onPreview,
  pageType,
  rowsFull,
  blocksFull,
}: {
  controller: TemplateController;
  use: TemplateUse;
  source: TemplateSource;
  onSource: (source: TemplateSource) => void;
  /** The tab is the one open, in a sidebar that is open. */
  shown: boolean;
  onBrowse: () => void;
  /** Opens the preview of a template; `opener` is the button, which gets the focus back when the preview closes. */
  onPreview: (item: TemplateItem, source: TemplateSource, opener: HTMLElement) => void;
  /** The kind of page being edited. */
  pageType: PageType;
  rowsFull: boolean;
  blocksFull: boolean;
}) {
  const { load } = controller;
  useEffect(() => {
    if (shown) load(source);
  }, [shown, source, load]);

  const list = controller.lists[source];
  const groups = groupTemplates(forPage(list.items, pageType));
  const empty = noneActivated(source);

  return (
    <>
      <p className="text-xs text-muted">
        Templates you have switched on. Press Preview to see one first, or Use to add a copy to the page: it is yours to
        change, and later edits by whoever shared it never reach it.
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
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm" title={item.name}>
                      {item.name}
                    </span>
                    {item.summary && <span className="text-xs text-muted">{item.summary}</span>}
                    <Publisher item={item} />
                  </div>
                  <CardButtons
                    item={item}
                    reason={blockedReason(item, { pageType, rowsFull, blocksFull })}
                    using={use.using === item.id}
                    disabled={use.using !== null}
                    onPreview={(opener) => onPreview(item, source, opener)}
                    onUse={() => use.run(item)}
                  />
                  <Problems problems={use.issues[item.id]} />
                  {use.added === item.id && (
                    <p role="status" className="text-xs text-muted">
                      Added to the page.
                    </p>
                  )}
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
