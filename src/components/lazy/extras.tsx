"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentType } from "react";

import { lazyView } from "./lazy-view";

/**
 * The store's extras (D211): each loaded only where it is drawn (`lazyView()`), the chat's button and a friend's referral capture
 * only once the browser is idle, so they never compete with the page for its first second. The consent manager and the owner's
 * necessary code load at once: the banner and that code must not wait.
 */
export const ConsentManager = lazyView(dynamic(() => import("../consent/consent-manager").then((m) => m.ConsentManager)));
export const StoreCustomCode = lazyView(dynamic(() => import("../consent/store-custom-code").then((m) => m.StoreCustomCode)));
export const ChatWidget = whenIdle(lazyView(dynamic(() => import("../chat-widget").then((m) => m.ChatWidget))));
// The keeper of a first visit (D303 I3) reads the consent cookie and the address only, so it waits for the browser to be idle too.
export const TouchKeeper = whenIdle(lazyView(dynamic(() => import("../touch-keeper").then((m) => m.TouchKeeper))));
export const AffiliateCapture = whenIdle(lazyView(dynamic(() => import("../affiliate-capture").then((m) => m.AffiliateCapture))));

/** Draws nothing until the browser is idle (or two seconds have passed), on the server too, so the first render agrees. */
function whenIdle<P extends object>(View: ComponentType<P>) {
  function Idle(props: P) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const ready = () => setReady(true);
      if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(ready, { timeout: 2000 });
        return () => window.cancelIdleCallback(id);
      }
      const id = setTimeout(ready, 1000);
      return () => clearTimeout(id);
    }, []);
    return ready ? <View {...props} /> : null;
  }
  return Idle;
}
