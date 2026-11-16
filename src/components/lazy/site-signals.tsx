"use client";

import dynamic from "next/dynamic";

import { lazyView, whenIdle } from "./lazy-view";

/**
 * Heatmaps' eyes on a store's pages (D656) load where they are drawn and once the browser is idle: nothing of them is in a page's first
 * scripts. A file of its own: only `extras.tsx` draws it, which pay routes leave out.
 */
export const SiteSignals = whenIdle(lazyView(dynamic(() => import("../signals/site-signals").then((m) => m.SiteSignals))));
