import type { CSSProperties } from "react";

import { timelineItemShows, type TimelineBlock } from "@/lib/page-content";

import { ListIcon } from "./list-icon";

/**
 * A timeline (D414) on the site: an ordered list of events along a line, each with a dot or its icon on the line, its date, title and words.
 * Along one side, the line at the left; alternating, the line runs down the middle from the `md` width and the events take turns on either
 * side, and on a phone they sit along one side. Drawn on the server: no script, and every event is in the page.
 */
export function TimelineView({ block }: { block: TimelineBlock }) {
  const items = block.items.filter(timelineItemShows);
  if (items.length === 0) return null;
  const alternate = block.layout === "alternate";
  const colour: CSSProperties | undefined = block.markerColor ? { color: block.markerColor } : undefined;
  return (
    <ol className="kz-timeline relative flex flex-col gap-8" data-timeline={alternate ? "alternate" : "side"}>
      {/* The line, behind the markers: at the left, or down the middle on wide screens when the events alternate. */}
      <span
        aria-hidden
        className={`absolute inset-y-1 left-3.5 w-0.5 -translate-x-1/2 bg-current opacity-30 ${alternate ? "md:left-1/2" : ""} ${block.markerColor ? "" : "text-accent"}`}
        style={colour}
      />
      {items.map((item, index) => {
        // Alternating: the first event on the left of the line, the next on the right, and so on (from `md`).
        const right = alternate && index % 2 === 1;
        return (
          <li
            key={item.id}
            className={`relative pl-11 ${alternate ? `md:w-1/2 ${right ? "md:ml-auto md:pl-11" : "md:pl-0 md:pr-11 md:text-right"}` : ""}`}
          >
            <span
              aria-hidden
              className={`absolute top-0.5 left-3.5 flex size-7 -translate-x-1/2 items-center justify-center rounded-full bg-current ${
                alternate ? (right ? "md:left-0" : "md:left-auto md:right-0 md:translate-x-1/2") : ""
              } ${block.markerColor ? "" : "text-accent"}`}
              style={colour}
            >
              {/* Solid in the line's colour, so it shows on any row's background; an icon in the site's background colour on it. */}
              {item.icon ? <ListIcon name={item.icon} className="size-4 text-background" /> : <span className="size-2.5 rounded-full bg-background" />}
            </span>
            {item.date.trim() && (
              <p data-kz-text="meta" className="text-sm font-medium text-muted">
                {item.date}
              </p>
            )}
            {item.title.trim() && (
              <p data-kz-text="title" className="text-lg leading-snug font-semibold text-balance">
                {item.title}
              </p>
            )}
            {item.text.trim() && (
              <p data-kz-text="body" className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">
                {item.text}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
