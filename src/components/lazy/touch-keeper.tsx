"use client";

import dynamic from "next/dynamic";

import { lazyView, whenIdle } from "./lazy-view";

/**
 * The keeper of a first visit (D303 I3) reads the consent cookie and the address only, so it loads where it is drawn and once the
 * browser is idle. A file of its own: the market layout draws it, and `extras.tsx` reaches the consent manager, which pay routes leave out.
 */
export const TouchKeeper = whenIdle(lazyView(dynamic(() => import("../touch-keeper").then((m) => m.TouchKeeper))));
