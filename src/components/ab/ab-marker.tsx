"use client";

import { useEffect } from "react";

import { dataCookieName, decodeAssignments, OUTSIDE } from "@/lib/experiments";

const read = (name: string): string | undefined => {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
};

const RELOADED = "kaizen_ab_reload";

const post = (path: string, body: object) =>
  void fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);

/** Tests whose exposure this tab has already reported: the server counts the first sight only, so this only saves requests. */
const reported = new Set<string>();

/**
 * Sits on a page under an A/B test (D148) and says which version of it this is. If the visitor's cookie gives them this
 * version, the page reports the exposure (and listens for clicks on the block the test counts). If it gives them another
 * (the browser still held this page from before they were assigned), it reloads once to get theirs. A visitor outside the
 * test, or with no answer, is not reported: nothing is recorded about them.
 */
export function AbMarker({
  storeId,
  store,
  market,
  experiment,
  variant,
  goalBlock,
}: {
  storeId: string;
  store: string;
  market: string;
  experiment: string;
  variant: string;
  goalBlock: string | null;
}) {
  useEffect(() => {
    const mine = decodeAssignments(read(dataCookieName(storeId)))?.versions[experiment];
    if (!mine || mine === OUTSIDE) return;
    if (mine !== variant) {
      // One reload per test and answer: the page that follows is the visitor's own version.
      try {
        if (window.sessionStorage.getItem(RELOADED) === `${experiment}.${mine}`) return;
        window.sessionStorage.setItem(RELOADED, `${experiment}.${mine}`);
      } catch {
        return;
      }
      window.location.reload();
      return;
    }
    if (!reported.has(experiment)) {
      reported.add(experiment);
      post("/api/ab/exposure", { store, market, experiment, variant });
    }
    if (!goalBlock) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("[data-block-id]") : null;
      if (target?.getAttribute("data-block-id") === goalBlock) post("/api/ab/event", { store, experiment, block: goalBlock });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [storeId, store, market, experiment, variant, goalBlock]);
  return null;
}
