"use client";

import dynamic from "next/dynamic";

import { lazyView } from "./lazy-view";

/**
 * The product page's own pickers (a stay's or rental's dates, an appointment's time, a gift card, a request for a quote), each loaded
 * only on a page that draws it (D211, `lazyView()`): imported as they are, they were in the first scripts of every product page. A
 * picker's script is asked for with the page's own, and the end-to-end tests showed no press lost (bloat review step 0.16,
 * `docs/performance.md`). One module per group of stand-ins, so a product page carries none of the shop's working pages' (bloat review
 * step 2.9, commit 3).
 */
export const RangePicker = lazyView(dynamic(() => import("../range-picker").then((m) => m.RangePicker)));
export const AppointmentPicker = lazyView(dynamic(() => import("../appointment-picker").then((m) => m.AppointmentPicker)));
export const GiftCardBuy = lazyView(dynamic(() => import("../gift-card-buy").then((m) => m.GiftCardBuy)));
export const QuoteRequest = lazyView(dynamic(() => import("../quote-request").then((m) => m.QuoteRequest)));
