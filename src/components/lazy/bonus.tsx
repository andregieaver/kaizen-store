"use client";

import dynamic from "next/dynamic";

import { lazyView } from "./lazy-view";

/**
 * The bonus credits' form (the cart, the checkout and My account), loaded only where it is drawn (D211, `lazyView()`): one module per
 * group of the shop's stand-ins, so the cart no longer carries My account's, a subscription's or the boxes' stand-ins with it (bloat
 * review step 2.9, commit 3).
 */
export const BonusCreditsForm = lazyView(dynamic(() => import("../bonus-credits-form").then((m) => m.BonusCreditsForm)));
