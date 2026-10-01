"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { CampaignNotices } from "@/lib/campaign-notices";
import type { GridData } from "@/lib/content-grid";
import type { ContentGridBlock } from "@/lib/page-content";
import { readSession, recordClick, signalsOf } from "@/lib/recommend-session";
import type { Placement, RecommendBlock, RecommendPlace } from "@/lib/recommendations";

import { ContentGridView } from "./content-grid";

type Outcome = { items: GridData["items"]; arm: "ai" | "baseline"; placement: Placement };

/** What was already reported as shown in this page view, so a grid that is drawn again is not counted again. */
const reported = new Set<string>();

function report(store: string, session: string, arm: "ai" | "baseline", placement: Placement, events: { productId: string; event: "impression" | "click" }[]) {
  if (events.length === 0) return;
  try {
    void fetch("/api/recommendations/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store, session, arm, placement, events }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting is for the owner's figures only; the page does not depend on it.
  }
}

/**
 * A product grid that recommends (D139) once the shopper's own session is known: it shows what the page was built with
 * (recommendations for everyone), asks the site for the shopper's (their cart, account and device's orders are read from the
 * request's cookies; what the tab remembers of the products looked at and the searches made is sent with it), and swaps
 * them in. A request that fails leaves the grid as it was. What was shown and what was clicked is reported by a random id
 * the tab made, for the owner's figures.
 */
export function RecommendedGrid({
  block,
  initial,
  notices,
  store,
  market,
  place,
  ask,
}: {
  block: ContentGridBlock;
  initial: GridData;
  notices?: CampaignNotices;
  store: string;
  market: string;
  place: RecommendPlace;
  ask: RecommendBlock;
}) {
  const [data, setData] = useState<GridData>(initial);
  const [outcome, setOutcome] = useState<Pick<Outcome, "arm" | "placement"> | null>(null);
  const session = useRef<string | null>(null);
  const search = useSearchParams().toString();

  useEffect(() => {
    const controller = new AbortController();
    let tab;
    try {
      tab = readSession(window.sessionStorage);
    } catch {
      tab = readSession(null);
    }
    session.current = tab.id;
    // A listing is recommended for what it was filtered to.
    const where: RecommendPlace = place.kind === "listing" ? { kind: "listing", query: search.slice(0, 600) } : place;
    fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store, market, session: tab.id, place: where, block: ask, signals: signalsOf(tab) }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<Outcome>) : null))
      .then((result) => {
        if (!result) return;
        setData((now) => ({ ...now, items: result.items }));
        setOutcome({ arm: result.arm, placement: result.placement });
        const fresh = result.items.filter((item) => !reported.has(`${result.placement}:${item.id}`));
        for (const item of fresh) reported.add(`${result.placement}:${item.id}`);
        report(store, tab.id, result.arm, result.placement, fresh.map((item) => ({ productId: item.id, event: "impression" as const })));
      })
      .catch(() => undefined);
    return () => controller.abort();
    // The request depends on where the grid is and, for a listing, on its filters.
  }, [store, market, place, ask, search]);

  /** A product opened from the grid: remembered in the tab, so adding it to the cart is credited, and reported. */
  const clicked = (event: MouseEvent<HTMLDivElement>) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>("li[data-item-id]");
    if (!tile || !(event.target as HTMLElement).closest("a") || !outcome || !session.current) return;
    const id = tile.dataset.itemId;
    if (!id) return;
    try {
      recordClick(window.sessionStorage, id, outcome.placement, outcome.arm);
    } catch {
      // Without session storage the click is still reported.
    }
    report(store, session.current, outcome.arm, outcome.placement, [{ productId: id, event: "click" }]);
  };

  return (
    // The tiles' own links do the work; the wrapper only notes which tile was used.
    <div onClick={clicked}>
      <ContentGridView block={block} data={data} notices={notices} />
    </div>
  );
}
