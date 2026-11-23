"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

import { slide, useFocusShows, useScroll } from "./header-chrome";

/**
 * The storefront's moving parts (D30): a header that slides away while the
 * shopper scrolls down and back when they scroll up, a bottom bar on phones
 * that does the opposite, and the slide-out menu. One scroll listener
 * serves them all (`header-chrome.tsx`, which holds the header and the menu so the admin loads only those).
 */

export { HidingHeader, MobileMenu } from "./header-chrome";

/**
 * Rendered by a page the header lies over (D80): marks the document while
 * the page is shown. Next keeps pages visited in the document, hidden, and
 * React takes a hidden page's effects away, so the mark follows the page
 * actually shown; before scripts run, the page's own `data-header-overlay`
 * does (globals.css).
 */
export function HeaderOverlayMark() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-overlay-live", "");
    root.setAttribute("data-overlay-on", "");
    return () => root.removeAttribute("data-overlay-on");
  }, []);
  return null;
}

/**
 * Rendered by a page with a header of its own (`PageContent.header`, 21 November 2026): marks the document while the page is shown, so the
 * site's header gives way to the page's (globals.css). As with `HeaderOverlayMark`, Next keeps pages visited in the document, hidden, so
 * the mark follows the page actually shown; before scripts run, the page's own header (`data-page-header`) does.
 */
export function PageHeaderMark() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-page-header-live", "");
    root.setAttribute("data-page-header-on", "");
    return () => root.removeAttribute("data-page-header-on");
  }, []);
  return null;
}

/** Whether this render is in the browser after hydration (false on the server and in the first, hydrating render). */
const noSubscribe = () => () => {};
const useInBrowser = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/**
 * The bottom bar dressed as the phone's slide-out menu is (D30, 21 November 2026): the menu takes its look from the header's menu
 * button (its background, its colour set and frosted glass, `DrawerLook`), so the bar copies that same background behind its links,
 * takes the same colour set and blur, and its own Menu button opens the menu as the header's does (the same kind, edge, background
 * and menu). A header with no look of its own leaves the bar as it was: the theme's background. Worked out in the browser after the
 * page is drawn, so the cached page stays the same; again after each navigation, as a page may bring a header of its own.
 */
function useMenuLookForBar(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [look, setLook] = useState({ own: false, surface: "", blur: 0 });
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    let gone = false;
    // The copying is its own module, fetched by the bar alone: the admin's frame draws `HidingHeader` from this file and needs none of it.
    void import("./bar-look").then(({ copyMenuLook }) => {
      if (!gone) setLook(copyMenuLook(bar, backgroundRef.current));
    });
    return () => {
      gone = true;
    };
  }, [pathname, ready]);
  return [ref, backgroundRef, look] as const;
}

/**
 * The bar along the bottom of a phone's screen; slides down out of view
 * while scrolling up, when the header comes back, so only one shows. A product's bar is drawn in the product's own part, deep in the page,
 * where a row with motion or its own layer would keep it under what follows (the tiles of You may also like, 15 November 2026): once the
 * page has hydrated it is moved to the end of the body, above every row, and stays under the admin's own buttons (z-50).
 */
export function HidingBottomBar({ children, product = false }: { children: ReactNode; product?: boolean }) {
  const { direction, atTop } = useScroll();
  const { focused, onFocus } = useFocusShows();
  const inBrowser = useInBrowser();
  const hidden = direction === "up" && !atTop && !focused;
  // A product's bar is drawn again at the end of the body once hydrated, so its look is copied again there.
  const [barRef, backgroundRef, look] = useMenuLookForBar(inBrowser);
  const bar = (
    <div
      ref={barRef}
      onFocus={onFocus}
      {...(product ? { "data-product-bar": "" } : { "data-default-bar": "" })}
      data-bar-look={look.own ? "" : undefined}
      style={look.blur > 0 ? { backdropFilter: `blur(${look.blur}px)`, WebkitBackdropFilter: `blur(${look.blur}px)` } : undefined}
      className={`fixed inset-x-0 bottom-0 isolate ${product ? "z-40" : "z-30"} border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden ${
        look.blur > 0 ? "" : look.own ? "bg-background" : "bg-background/95 backdrop-blur"
      } ${look.surface} ${slide} ${hidden ? "translate-y-full" : "translate-y-0"}`}
    >
      <div ref={backgroundRef} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" />
      {children}
    </div>
  );
  return product && inBrowser ? createPortal(bar, document.body) : bar;
}

