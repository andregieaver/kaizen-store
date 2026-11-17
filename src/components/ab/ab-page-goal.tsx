"use client";

import { useEffect } from "react";

import { dataCookieName, decodeAssignments, OUTSIDE } from "@/lib/experiments";
import { previewedTest } from "@/lib/ab-preview";

const read = (name: string): string | undefined => {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
};

/** Tests whose page goal this tab has already reported: the server counts the first only, so this only saves requests. */
const reported = new Set<string>();

/**
 * Sits on a page that a running A/B test's goal names (D148 phase 20: "going on to a page") and says the visitor opened it, for each such test the
 * visitor has a version of. The server counts it only for a visitor who was shown the test before, in the version they saw. A visitor outside the
 * test, with no answer, or looking through a preview link is not reported: nothing is recorded about them. Draws nothing.
 */
export function AbPageGoal({ storeId, store, pageId, experiments }: { storeId: string; store: string; pageId: string; experiments: string[] }) {
  useEffect(() => {
    const mine = decodeAssignments(read(dataCookieName(storeId)))?.versions;
    if (!mine) return;
    const preview = previewedTest(read);
    for (const experiment of experiments) {
      const version = mine[experiment];
      if (!version || version === OUTSIDE || preview === experiment || reported.has(experiment)) continue;
      reported.add(experiment);
      void fetch("/api/ab/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, experiment, page: pageId }),
        keepalive: true,
      }).catch(() => undefined);
    }
  }, [storeId, store, pageId, experiments]);
  return null;
}
