"use client";

import dynamic from "next/dynamic";

import { lazyView, whenIdle } from "./lazy-view";

/**
 * The store's extras (D211): each loaded only where it is drawn (`lazyView()`), the chat's button and a friend's referral capture
 * only once the browser is idle, so they never compete with the page for its first second. The consent manager and the owner's
 * necessary code load at once: the banner and that code must not wait.
 */
export const ConsentManager = lazyView(dynamic(() => import("../consent/consent-manager").then((m) => m.ConsentManager)));
export const StoreCustomCode = lazyView(dynamic(() => import("../consent/store-custom-code").then((m) => m.StoreCustomCode)));
export const ChatWidget = whenIdle(lazyView(dynamic(() => import("../chat-widget").then((m) => m.ChatWidget))));
export const AffiliateCapture = whenIdle(lazyView(dynamic(() => import("../affiliate-capture").then((m) => m.AffiliateCapture))));

