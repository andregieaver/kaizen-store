"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import type { HeaderStageLook } from "@/lib/header-stages";
import { DEFAULT_MENU_LOOK, menuDrag, menuDragCloses, menuLookFrom, menuOverlayClass, menuPanelClass, menuSwipe, type MenuLook } from "@/lib/menu-drawer";

import { useHeaderThemeColor } from "./header-theme-color";

/**
 * The storefront's moving parts (D30): a header that slides away while the
 * shopper scrolls down and back when they scroll up, a bottom bar on phones
 * that does the opposite, and the slide-out menu. One scroll listener
 * serves them all.
 */

type Scroll = { direction: "up" | "down" | null; atTop: boolean };

const SERVER: Scroll = { direction: null, atTop: true };
/** Movement smaller than this is jitter (and iOS's bounce), not a change of direction. */
const THRESHOLD = 8;
/** Near the top of the page, both bars show. */
const TOP = 64;

let scroll: Scroll = SERVER;
let lastY = 0;
const listeners = new Set<() => void>();

function onScroll() {
  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (y < 0 || y > max) return; // Rubber-banding past either end.
  const atTop = y < TOP;
  let direction = scroll.direction;
  if (Math.abs(y - lastY) >= THRESHOLD) {
    direction = y > lastY ? "down" : "up";
    lastY = y;
  }
  if (atTop !== scroll.atTop || direction !== scroll.direction) {
    scroll = { direction, atTop };
    for (const listener of listeners) listener();
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    lastY = window.scrollY;
    scroll = { direction: null, atTop: lastY < TOP };
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("scroll", onScroll);
  };
}

function useScroll(): Scroll {
  return useSyncExternalStore(subscribe, () => scroll, () => SERVER);
}

/** Keyboard users tabbing into a hidden bar get it back until they scroll again. */
function useFocusShows() {
  const { direction } = useScroll();
  const [focusedWhile, setFocusedWhile] = useState<Scroll["direction"] | "never">("never");
  return { focused: focusedWhile === direction, onFocus: () => setFocusedWhile(direction) };
}

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

const slide = "transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none";

/**
 * Stays at the top of the screen; slides up out of view while scrolling
 * down. A header that may lie over the page (D80) is marked for the
 * stylesheet, which lays it over a page that asks for it (`data-header-overlay`)
 * and makes it see-through while the page is at its top. Its two stages (D533,
 * `headerStageLook()`: at the top, and back again on scroll) come as data
 * attributes and custom properties that `globals.css` draws.
 *
 * On every site (Kaizena Flow's and the stores') the phone browser's colour follows it (`useHeaderThemeColor`); the admin's
 * header leaves it (`themeColor={false}`).
 */
export function HidingHeader({
  children,
  overlay,
  themeColor = true,
}: {
  children: ReactNode;
  overlay?: HeaderStageLook;
  themeColor?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  useHeaderThemeColor(wrap, themeColor);
  const { direction, atTop } = useScroll();
  const { focused, onFocus } = useFocusShows();
  const hidden = direction === "down" && !atTop && !focused;
  return (
    <div
      ref={wrap}
      onFocus={onFocus}
      data-header-wrap={overlay ? "" : undefined}
      data-hiding-header
      data-at-top={overlay && atTop ? "" : undefined}
      {...overlay?.attrs}
      style={overlay && Object.keys(overlay.style).length > 0 ? (overlay.style as CSSProperties) : undefined}
      className={`sticky top-0 z-30 ${slide} ${hidden ? "-translate-y-full" : "translate-y-0"}`}
    >
      {children}
    </div>
  );
}

/**
 * The bar along the bottom of a phone's screen; slides down out of view
 * while scrolling up, when the header comes back, so only one shows.
 */
export function HidingBottomBar({ children, product = false }: { children: ReactNode; product?: boolean }) {
  const { direction, atTop } = useScroll();
  const { focused, onFocus } = useFocusShows();
  const hidden = direction === "up" && !atTop && !focused;
  return (
    <div
      onFocus={onFocus}
      {...(product ? { "data-product-bar": "" } : { "data-default-bar": "" })}
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden ${slide} ${
        hidden ? "translate-y-full" : "translate-y-0"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * The phone menu: a modal dialog over a dimmed page, so focus stays inside and Escape closes it; tapping outside, choosing a link or
 * swiping it back towards its edge closes it too. It sits at the end of the page, so its links come after the page's own content; any
 * button marked `data-open-menu` opens it, in the look that button asks for (`src/lib/menu-drawer.ts`): a panel from the left (the
 * standard), the right, the top or the bottom, the whole screen, a panel dropping under the header or a floating card, and the
 * background a menu button carries for it (`data-menu-look`), copied behind the links as it opens.
 */
export function MobileMenu({
  title,
  labels,
  children,
}: {
  title: ReactNode;
  labels: { close: string; menu: string };
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [look, setLook] = useState<MenuLook>(DEFAULT_MENU_LOOK);
  const [surface, setSurface] = useState("");
  // Frosted glass (D86): what is behind the menu blurred, the theme's background left out so it shows through.
  const [blur, setBlur] = useState(0);
  const [top, setTop] = useState(0);
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number; bar: boolean; along: boolean | null } | null>(null);

  const show = (opener: HTMLElement | null) => {
    const d = dialog.current;
    if (!d || d.open) return;
    const next = opener ? menuLookFrom(opener.dataset) : DEFAULT_MENU_LOOK;
    setLook(next);
    // The opener's own background for the menu, if it carries one; none leaves the theme's.
    const holder = opener?.dataset.menuLook ? document.getElementById(opener.dataset.menuLook) : null;
    backdrop.current?.replaceChildren(...(holder ? Array.from((holder.cloneNode(true) as HTMLElement).childNodes) : []));
    setSurface(holder?.dataset.menuSurface ?? "");
    setBlur(Number(holder?.dataset.menuBlur) || 0);
    // A dropdown hangs from the bottom of the header the button is in.
    if (next.type === "dropdown" && opener) {
      setTop(Math.max(0, Math.round((opener.closest("header") ?? opener).getBoundingClientRect().bottom)));
    }
    d.showModal();
    document.documentElement.style.overflow = "hidden";
    // Drawn closed in its new look first, then opened, so it moves in from its own edge.
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };
  const hide = () => {
    setOpen(false);
    setDrag(0);
    document.documentElement.style.overflow = "";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => dialog.current?.close(), reduced ? 0 : 300);
  };

  // Any button marked `data-open-menu` opens it, such as the bottom bar's Menu.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const opener = (event.target as Element | null)?.closest?.("[data-open-menu]");
      if (opener) show(opener as HTMLElement);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      document.documentElement.style.overflow = "";
    };
  }, []);

  const swipe = menuSwipe(look);
  const dropdown = look.type === "dropdown";
  const moved: CSSProperties = {
    ...(blur > 0 && { backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)` }),
    ...(drag !== 0 && { transform: swipe.axis === "x" ? `translateX(${drag}px)` : `translateY(${drag}px)`, transition: "none" }),
  };

  return (
    <>
      <dialog
        ref={dialog}
        id="store-menu"
        aria-label={labels.menu}
        onCancel={(event) => {
          event.preventDefault();
          hide();
        }}
        onClick={(event) => {
          // A link chosen, or a tap beside a dropdown (on the header it hangs from), closes it.
          if (event.target === event.currentTarget || (event.target as Element).closest("a")) hide();
        }}
        style={{ "--menu-top": `${top}px` } as CSSProperties}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
      >
        <div
          aria-hidden="true"
          onClick={hide}
          className={`fixed ${menuOverlayClass(look)} bg-black/40 transition-opacity duration-300 motion-reduce:transition-none ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          ref={panel}
          data-menu-type={look.type}
          data-menu-side={look.side}
          style={moved}
          onTouchStart={(event) => {
            const t = event.touches[0];
            touch.current = { x: t.clientX, y: t.clientY, bar: Boolean((event.target as Element).closest("[data-menu-bar]")), along: null };
          }}
          onTouchMove={(event) => {
            const start = touch.current;
            if (!start) return;
            const t = event.touches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            if (start.along === null && Math.abs(dx) + Math.abs(dy) > 10) {
              const sideways = Math.abs(dx) > Math.abs(dy);
              // Up or down only from the top bar, so the links still scroll.
              start.along = (swipe.axis === "x") === sideways && (swipe.axis === "x" || start.bar);
            }
            if (start.along) setDrag(menuDrag(look, dx, dy));
          }}
          onTouchEnd={() => {
            const size = (swipe.axis === "x" ? panel.current?.offsetWidth : panel.current?.offsetHeight) ?? 300;
            touch.current = null;
            if (menuDragCloses(drag, size)) hide();
            else setDrag(0);
          }}
          className={`fixed isolate flex flex-col overflow-hidden ${blur > 0 ? "" : "bg-background"} shadow-2xl transition-[translate,transform,opacity] duration-300 ease-out motion-reduce:transition-none ${surface} ${menuPanelClass(look, open)}`}
        >
          <div ref={backdrop} aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden [border-radius:inherit]" />
          <div className="flex min-h-0 flex-auto flex-col overflow-y-auto overscroll-contain">
            <div data-menu-bar="" className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
              {look.side === "bottom" && !dropdown && (
                <span aria-hidden="true" className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-current/20" />
              )}
              {/* A dropdown hangs under the header, which already shows the logo. */}
              <div className="min-w-0 truncate">{!dropdown && title}</div>
              <button
                type="button"
                onClick={hide}
                className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
                <span className="sr-only">{labels.close}</span>
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-6 px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">{children}</div>
          </div>
        </div>
      </dialog>
    </>
  );
}
