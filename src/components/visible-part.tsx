import { Suspense, type ReactNode } from "react";

import { isConditional, showsFor, type Show } from "@/lib/visibility";
import type { GridPlace } from "@/server/content-grid";
import { visitorFacts } from "@/server/visibility";

/**
 * A row, column or component drawn by who sees it (D179 phase 4, `docs/responsive-editing.md` 6): Always draws it; Never
 * draws nothing on the site; signed in, signed out and conditions are a `<Suspense>` hole that reads the visitor's facts
 * for this request and draws the part or nothing, so the page around it stays cached and prerendered and a part not shown
 * is not in the page at all. Search engines, signed out and without a cart, see what any signed-out visitor sees.
 *
 * In the admin's preview of a page (`preview`) nobody is visiting, so every part but a Never one is drawn, as the builder
 * shows them.
 */
export function VisiblePart({ show, place, preview = false, children }: { show: Show | undefined; place: GridPlace; preview?: boolean; children: ReactNode }) {
  if (show === undefined || show === "always") return children;
  if (show === "never") return null;
  if (preview || !isConditional(show)) return children;
  return (
    <Suspense fallback={null}>
      <Shown show={show} place={place}>
        {children}
      </Shown>
    </Suspense>
  );
}

async function Shown({ show, place, children }: { show: Show; place: GridPlace; children: ReactNode }) {
  const facts = await visitorFacts(place, show);
  return showsFor(show, facts) ? children : null;
}
