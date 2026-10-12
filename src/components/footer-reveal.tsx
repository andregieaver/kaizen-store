"use client";

import { useEffect } from "react";

/**
 * Switches a footer's reveal on scroll (D184) on only where it can work: the page above the footer must be at least a screen
 * tall, or the footer pinned under it would show its top half behind a short page, and the footer must fit the screen. Marks
 * `<html data-footer-reveal>`; globals.css pins the footer only then, so a short page, or one without JavaScript, shows it
 * where it always is.
 *
 * It is pinned only once the visitor has scrolled to within a screen of the page's end, never at the first paint: pinned, the footer lies
 * on the screen under the page from the start, and browsers count what is painted there (its background picture became the
 * page's largest paint, found by Lighthouse) though the page covers it. Pinned while the page's end is still below the screen,
 * the switch cannot be seen; once on, it stays on.
 */
export function FooterRevealGuard() {
  useEffect(() => {
    const root = document.documentElement;
    const footer = document.querySelector<HTMLElement>(".site-footer[data-reveal]");
    if (!footer) return;
    let near = false;
    const measure = () => {
      // The room the phone's bottom bar takes is the footer's `bottom` offset, so it counts against the screen.
      const bar = parseFloat(getComputedStyle(footer).bottom) || 0;
      let end = 0;
      for (const el of Array.from(document.body.children)) {
        if (el === footer) break;
        if (el instanceof HTMLElement && getComputedStyle(el).position !== "fixed") end = Math.max(end, el.offsetTop + el.offsetHeight);
      }
      const screen = window.innerHeight;
      // Only after a scroll (or a page opened scrolled): a visitor who has not scrolled sees no reveal, and nothing is painted under the page.
      near ||= window.scrollY > 0 && end - (window.scrollY + screen) < screen;
      root.toggleAttribute("data-footer-reveal", near && end >= screen - bar && footer.offsetHeight <= screen - bar);
    };
    let frame = 0;
    const scrolled = () => {
      if (near) return window.removeEventListener("scroll", scrolled);
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), measure()));
    };
    measure();
    window.addEventListener("scroll", scrolled, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    observer.observe(footer);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", scrolled);
      cancelAnimationFrame(frame);
      root.removeAttribute("data-footer-reveal");
    };
  }, []);
  return null;
}
