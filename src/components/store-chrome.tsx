"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

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

const slide = "transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none";

/** Stays at the top of the screen; slides up out of view while scrolling down. */
export function HidingHeader({ children }: { children: ReactNode }) {
  const { direction, atTop } = useScroll();
  const { focused, onFocus } = useFocusShows();
  const hidden = direction === "down" && !atTop && !focused;
  return (
    <div
      onFocus={onFocus}
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
 * The phone menu: slides in from the left over a dimmed page. A modal
 * dialog, so focus stays inside and Escape closes it; tapping outside,
 * choosing a link or swiping it left closes it too. It sits at the end of
 * the page, so its links come after the page's own content; any button
 * marked `data-open-menu` opens it.
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
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number; sideways: boolean | null } | null>(null);

  const show = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => setOpen(true));
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
      if ((event.target as Element | null)?.closest?.("[data-open-menu]")) show();
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      document.documentElement.style.overflow = "";
    };
  }, []);

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
          if ((event.target as Element).closest("a")) hide();
        }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
      >
        <div
          aria-hidden="true"
          onClick={hide}
          className={`fixed inset-0 bg-black/40 transition-opacity duration-300 motion-reduce:transition-none ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          ref={panel}
          style={drag ? { transform: `translateX(${drag}px)`, transition: "none" } : undefined}
          onTouchStart={(event) => {
            const t = event.touches[0];
            touch.current = { x: t.clientX, y: t.clientY, sideways: null };
          }}
          onTouchMove={(event) => {
            const start = touch.current;
            if (!start) return;
            const t = event.touches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            if (start.sideways === null && Math.abs(dx) + Math.abs(dy) > 10) start.sideways = Math.abs(dx) > Math.abs(dy);
            if (start.sideways) setDrag(Math.min(0, dx));
          }}
          onTouchEnd={() => {
            const width = panel.current?.offsetWidth ?? 300;
            touch.current = null;
            if (drag < -width / 4) hide();
            else setDrag(0);
          }}
          className={`fixed inset-y-0 left-0 flex w-[85%] max-w-sm flex-col overflow-y-auto overscroll-contain bg-background shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <div className="min-w-0 truncate">{title}</div>
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
      </dialog>
    </>
  );
}
