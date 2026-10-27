"use client";

import dynamic from "next/dynamic";

import { lazyView, whenIdle } from "./lazy-view";

/**
 * The country suggestion (D338) is drawn only for a visitor from another country the store sells to, so it loads where it is drawn and once
 * the browser is idle. A file of its own: the market layout draws it, and `extras.tsx` reaches the consent manager, which pay routes leave out.
 */
export const CountryHint = whenIdle(lazyView(dynamic(() => import("../country-hint").then((m) => m.CountryHint))));
