"use client";

import { lazy, Suspense, useState, type ComponentProps } from "react";

/**
 * Customise, the flow's canvas behind one press (D767): the chart and its drag and drop (`flow-board.tsx`, `@dnd-kit`) load only once it is
 * opened, so the flow's page keeps its first scripts (the bundle budget, D378); Homer reading the story never fetches them. `React.lazy`
 * rather than `next/dynamic`: it is never drawn on the server (a press starts it), so there is no script to preload.
 */
const FlowBoard = lazy(() => import("./flow-board").then((m) => ({ default: m.FlowBoard })));

type Props = ComponentProps<typeof FlowBoard> & { customise: string; lead: string };

export function FlowCanvasSection({ customise, lead, ...board }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-panel border border-line bg-card px-4 py-3" data-flow-canvas onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-body-strong text-ink">{customise}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-caption text-muted">{lead}</p>
        {open && (
          <Suspense fallback={<div className="min-h-64 rounded-lg border border-line bg-sunken/60" aria-busy />}>
            <FlowBoard {...board} />
          </Suspense>
        )}
      </div>
    </details>
  );
}
