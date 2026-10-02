"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A thin bar along the top of the admin while a page is loading: it starts when a link to another page of the admin is
 * pressed, creeps forward, and finishes (and fades) when the address changes. It touches the DOM directly, so drawing it
 * never re-renders the page, and it is only there to say "something is happening": a failed or cancelled navigation
 * ends it after a few seconds. Looks are in `admin.css` (`.admin-progress`), which also stills it for reduced motion.
 */
const GIVE_UP_MS = 10_000;

export function AdminProgress() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);
  const giveUp = useRef<number | undefined>(undefined);

  const set = (state: "loading" | "done" | "idle") => {
    const el = bar.current;
    if (!el) return;
    window.clearTimeout(giveUp.current);
    if (state === "idle") {
      el.removeAttribute("data-state");
      return;
    }
    if (state === "loading") {
      // Restart from the left: remove the state, force a style flush, then set it.
      el.removeAttribute("data-state");
      void el.offsetWidth;
      el.setAttribute("data-state", "loading");
      giveUp.current = window.setTimeout(() => set("done"), GIVE_UP_MS);
      return;
    }
    el.setAttribute("data-state", "done");
    giveUp.current = window.setTimeout(() => set("idle"), 700);
  };

  // The address changed: the page has arrived.
  useEffect(() => {
    if (bar.current?.getAttribute("data-state") === "loading") set("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin || !to.pathname.startsWith("/admin")) return;
      // The same page (a hash, or nothing) is not a navigation.
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      set("loading");
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      window.clearTimeout(giveUp.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={bar} aria-hidden="true" className="admin-progress" />;
}
