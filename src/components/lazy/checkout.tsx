"use client";

import dynamic from "next/dynamic";

import { lazyView } from "./lazy-view";

/**
 * The checkout's payment form, loaded only where it is drawn (D211, `lazyView()`): one module per group of the shop's stand-ins, so a
 * route carries only the stand-ins it draws (bloat review step 2.9, commit 3; the rule of what may wait is in `docs/performance.md`).
 */
export const CheckoutForm = lazyView(dynamic(() => import("../checkout-form").then((m) => m.CheckoutForm)));
