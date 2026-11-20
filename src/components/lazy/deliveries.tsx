"use client";

import dynamic from "next/dynamic";

import { lazyView } from "./lazy-view";

/**
 * The subscription boxes' forms, loaded only where they are drawn (D211, `lazyView()`): one module per group of the shop's stand-ins, so
 * a route carries only the stand-ins it draws (bloat review step 2.9, commit 3).
 */
export const DeliverySetupForm = lazyView(dynamic(() => import("@/app/s/[store]/[market]/(shop)/deliveries/delivery-forms").then((m) => m.DeliverySetupForm)));
export const DeliveryAddressForm = lazyView(dynamic(() => import("@/app/s/[store]/[market]/(shop)/deliveries/delivery-forms").then((m) => m.DeliveryAddressForm)));
export const ConfirmButton = lazyView(dynamic(() => import("@/app/s/[store]/[market]/(shop)/deliveries/delivery-forms").then((m) => m.ConfirmButton)));
