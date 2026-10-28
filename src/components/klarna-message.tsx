"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";

import type { KlarnaElementProps } from "./klarna-element";

/** Stripe's keys for the store's account and the market, from `klarnaMessaging()` (D373). */
export type KlarnaSetup = { publishableKey: string; stripeAccount: string; currency: string; country: string; locale: string };

/**
 * Klarna's line under a price (wave 10 unit J, D373), where Klarna is active on the store's account for the country: Stripe's messaging
 * element, which says whether and how the amount can be paid with Klarna. Nothing of Stripe's is in the page's first scripts: the element
 * (`klarna-element.tsx`) is loaded once the price is on the screen and the browser is idle, and the space stays empty until it draws.
 */
export function KlarnaMessage({ amountMinor, ...setup }: KlarnaSetup & { amountMinor: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [Element, setElement] = useState<ComponentType<KlarnaElementProps> | null>(null);
  useEffect(() => {
    const node = box.current;
    if (!node || Element) return;
    let cancelled = false;
    const load = () =>
      void import("./klarna-element").then((loaded) => {
        if (!cancelled) setElement(() => loaded.KlarnaElement);
      });
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 2000 });
      else setTimeout(load, 500);
    });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [Element]);
  return (
    <div ref={box} data-klarna-message className="min-h-0 w-full max-w-sm">
      {Element && <Element {...setup} amountMinor={amountMinor} />}
    </div>
  );
}
