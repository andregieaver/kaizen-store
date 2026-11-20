"use client";

import dynamic from "next/dynamic";

import { lazyView } from "./lazy-view";

/**
 * A subscription's buttons and contents form, loaded only where they are drawn (D211, `lazyView()`): one module per group of the shop's
 * stand-ins, so a route carries only the stand-ins it draws (bloat review step 2.9, commit 3).
 */
export const SubscriptionButton = lazyView(dynamic(() => import("../subscription-button").then((m) => m.SubscriptionButton)));
export const SubscriptionContentsForm = lazyView(dynamic(() => import("../subscription-contents-form").then((m) => m.SubscriptionContentsForm)));
