"use client";

import { useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";

import { menuDrag, menuDragCloses, menuOverlayClass, menuPanelClass, menuSwipe, type MenuLook } from "@/lib/menu-drawer";

/**
 * The dimmed page and the panel of a phone drawer, inside its `<dialog>`: the phone menu (`MobileMenu`) and the slide-out cart
 * (`CartDrawer`). It lies where its look says (`src/lib/menu-drawer.ts`: a side panel, the whole screen, under the header or a floating
 * card, from its edge), on the background the owner gave it, with what it holds read in that background's colour set (`surface`,
 * D390) or as frosted glass (`blur`, D86). A swipe back towards its edge closes it: across the panel from the left or right, up or down
 * only from its top bar, so what it holds still scrolls.
 */
export function DrawerPanel({
  look,
  open,
  wide = false,
  surface = "",
  blur = 0,
  background,
  backgroundRef,
  bar,
  closeLabel,
  onClose,
  bodyClassName,
  children,
}: {
  look: MenuLook;
  open: boolean;
  /** The cart's: a little wider from the left or right. */
  wide?: boolean;
  /** `kz-on-light` or `kz-on-dark` for its own background, or nothing. */
  surface?: string;
  /** Pixels of blur of what is behind it; with any, the theme's background is left out so the page shows through. */
  blur?: number;
  /** Its own background, drawn behind what it holds (the cart's, from the server). */
  background?: ReactNode;
  /** Or the element its background is copied into as it opens (the menu's, from the button that opened it). */
  backgroundRef?: Ref<HTMLDivElement>;
  /** The top bar's start: the menu's logo, the cart's heading. */
  bar: ReactNode;
  closeLabel: string;
  onClose: () => void;
  bodyClassName: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number; bar: boolean; along: boolean | null } | null>(null);
  const swipe = menuSwipe(look);
  const close = () => {
    setDrag(0);
    onClose();
  };
  const style: CSSProperties = {
    ...(blur > 0 && { backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)` }),
    ...(drag !== 0 && { transform: swipe.axis === "x" ? `translateX(${drag}px)` : `translateY(${drag}px)`, transition: "none" }),
  };
  return (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        className={`fixed ${menuOverlayClass(look)} bg-black/40 transition-opacity duration-300 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
      />
      <div
        ref={panel}
        data-drawer-type={look.type}
        data-drawer-side={look.side}
        style={style}
        onTouchStart={(event) => {
          const t = event.touches[0];
          touch.current = { x: t.clientX, y: t.clientY, bar: Boolean((event.target as Element).closest("[data-drawer-bar]")), along: null };
        }}
        onTouchMove={(event) => {
          const start = touch.current;
          if (!start) return;
          const t = event.touches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (start.along === null && Math.abs(dx) + Math.abs(dy) > 10) {
            const sideways = Math.abs(dx) > Math.abs(dy);
            // Up or down only from the top bar, so what it holds still scrolls.
            start.along = (swipe.axis === "x") === sideways && (swipe.axis === "x" || start.bar);
          }
          if (start.along) setDrag(menuDrag(look, dx, dy));
        }}
        onTouchEnd={() => {
          const size = (swipe.axis === "x" ? panel.current?.offsetWidth : panel.current?.offsetHeight) ?? 300;
          touch.current = null;
          if (menuDragCloses(drag, size)) close();
          else setDrag(0);
        }}
        className={`fixed isolate flex flex-col overflow-hidden ${blur > 0 ? "" : "bg-background"} shadow-2xl transition-[translate,transform,opacity] duration-300 ease-out motion-reduce:transition-none ${surface} ${menuPanelClass(look, open, wide)}`}
      >
        <div ref={backgroundRef} aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden [border-radius:inherit]">
          {background}
        </div>
        <div data-drawer-bar="" className="relative flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          {look.side === "bottom" && look.type !== "dropdown" && (
            <span aria-hidden="true" className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-current/20" />
          )}
          <div className="min-w-0 truncate">{bar}</div>
          <button type="button" onClick={close} className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
            <span className="sr-only">{closeLabel}</span>
          </button>
        </div>
        <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain">
          <div className={bodyClassName}>{children}</div>
        </div>
      </div>
    </>
  );
}
