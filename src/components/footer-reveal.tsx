"use client";

import { useEffect } from "react";

/**
 * Switches a footer's reveal on scroll (D184) on only where it can work: the page above the footer must be at least a screen
 * tall, or the footer pinned under it would show its top half behind a short page, and the footer must fit the screen. Marks
 * `<html data-footer-reveal>`; globals.css pins the footer only then, so a short page, or one without JavaScript, shows it
 * where it always is.
 */
export function FooterRevealGuard() {
  useEffect(() => {
    const root = document.documentElement;
    const footer = document.querySelector<HTMLElement>(".site-footer[data-reveal]");
    if (!footer) return;
    const measure = () => {
      // The room the phone's bottom bar takes is the footer's `bottom` offset, so it counts against the screen.
      const bar = parseFloat(getComputedStyle(footer).bottom) || 0;
      let end = 0;
      for (const el of Array.from(document.body.children)) {
        if (el === footer) break;
        if (el instanceof HTMLElement && getComputedStyle(el).position !== "fixed") end = Math.max(end, el.offsetTop + el.offsetHeight);
      }
      const screen = window.innerHeight;
      root.toggleAttribute("data-footer-reveal", end >= screen - bar && footer.offsetHeight <= screen - bar);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    observer.observe(footer);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      root.removeAttribute("data-footer-reveal");
    };
  }, []);
  return null;
}
