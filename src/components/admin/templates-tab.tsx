"use client";

import { useEffect } from "react";

import type { PageType } from "@/lib/page-content";
import { fillWords } from "@/lib/admin-fill";
import { TEMPLATE_SOURCES, type TemplateItem, type TemplateSource } from "@/lib/templates";

import { useAdminText } from "./admin-text";

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
  own = false,
}: {
  controller: TemplateController;
  use: TemplateUse;
  source: TemplateSource;
  onSource: (source: TemplateSource) => void;
  /** The tab is the one open, in a sidebar that is open. */
  shown: boolean;
  onBrowse: () => void;
  /** Kaizen's own builder (D236): one source, its own templates, always on. */
  own?: boolean;
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
  const w = useAdminText("builder").templates;
  const groups = groupTemplates(forPage(list.items, pageType), w);
  const empty = noneActivated(source, own, w);

  return (
    <>
      <p className="text-xs text-muted">
        {own ? w.introOwn : w.intro}
      </p>
      <div role="group" aria-label={w.from} hidden={own} className="grid grid-cols-2 gap-1 rounded-md bg-sunken p-1">
        {TEMPLATE_SOURCES.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={source === each}
            onClick={() => onSource(each)}
            className="min-h-9 rounded px-2 text-xs font-medium text-muted aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-sm"
          >
            {w.sources[each]}
          </button>
        ))}
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
        <p role="status" className="text-xs text-muted">
          {w.loading}
        </p>
      ) : groups.length === 0 ? (
        <EmptyState title={empty.title} hint={empty.hint} />
      ) : (
        groups.map((group) => (
          <section
            key={group.kind}
            aria-label={fillWords(w.group, { kind: group.label.toLowerCase() })}
            className="flex flex-col gap-2"
          >
            <h3 className={groupHeading}>{group.label}</h3>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm" title={item.name}>
                      {item.name}
                    </span>
                    {item.summary && <span className="text-xs text-muted">{item.summary}</span>}
                    <Publisher item={item} />
                  </div>
                  <CardButtons
                    item={item}
                    reason={blockedReason(item, { pageType, rowsFull, blocksFull }, w)}
                    using={use.using === item.id}
                    disabled={use.using !== null}
                    onPreview={(opener) => onPreview(item, source, opener)}
                    onUse={() => use.run(item)}
                  />
                  <Problems problems={use.issues[item.id]} />
                  {use.added === item.id && (
                    <p role="status" className="text-xs text-muted">
                      {w.added}
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
        className="min-h-10 rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken"
      >
        {w.browse}
      </button>
    </>
  );
}
