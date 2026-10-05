"use client";

import { useId, useRef, useState, type ReactNode } from "react";

import type { TabsAlign, TabsLook } from "@/lib/page-content";

// Written out whole so Tailwind finds every class.
const LISTS: Record<TabsLook, string> = {
  underline: "border-b border-border",
  pills: "gap-2",
  boxed: "gap-1 border-b border-border",
};
const TABS: Record<TabsLook, string> = {
  underline: "-mb-px border-b-2 border-transparent px-4 aria-selected:border-current aria-selected:font-semibold",
  pills: "rounded-button px-4 aria-selected:bg-foreground aria-selected:text-background",
  boxed: "-mb-px rounded-t-md border border-transparent px-4 aria-selected:border-border aria-selected:border-b-background aria-selected:bg-background aria-selected:font-semibold",
};
const ALIGN: Record<TabsAlign, string> = { start: "justify-start", center: "justify-center", stretch: "[&>*]:flex-1" };

/**
 * Tabs (D91) as the ARIA pattern has them: the tab list's buttons choose
 * the panel shown, arrow keys move between tabs (Home and End to the
 * ends) and choose as they go. Every panel is in the page, the others
 * hidden, so search engines and the browser read them all.
 */
export function TabsView({
  titles,
  look,
  align,
  panels,
}: {
  titles: ReactNode[];
  look: TabsLook;
  align: TabsAlign;
  /** Each tab's panel, drawn by the server. */
  panels: ReactNode[];
}) {
  const [chosen, setChosen] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (index: number) => {
    const next = (index + titles.length) % titles.length;
    setChosen(next);
    tabs.current[next]?.focus();
  };
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className={`flex overflow-x-auto ${LISTS[look]} ${ALIGN[align]}`}>
        {titles.map((title, index) => (
          <button
            key={index}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            id={`${id}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={chosen === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={chosen === index ? 0 : -1}
            onClick={() => setChosen(index)}
            onKeyDown={(event) => {
              const to = { ArrowRight: chosen + 1, ArrowLeft: chosen - 1, Home: 0, End: titles.length - 1 }[event.key];
              if (to === undefined) return;
              event.preventDefault();
              choose(to);
            }}
            className={`min-h-11 shrink-0 whitespace-nowrap text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 md:text-base ${TABS[look]}`}
          >
            {title}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div
          key={index}
          id={`${id}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`}
          hidden={chosen !== index}
          tabIndex={0}
          className="focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
