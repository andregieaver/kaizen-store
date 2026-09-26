"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

const DESKTOP = "(min-width: 768px)";

/**
 * The slide-out cart on phones: the cart, opened over the page the shopper
 * was on (the intercepted `/cart`, `@drawer/(.)cart`). Closing goes back to
 * that page. On larger screens the cart is a page of its own, so there the
 * address, which is already the cart's, is loaded as one.
 */
export function CartDrawer({
  title,
  labels,
  children,
}: {
  title: string;
  labels: { close: string };
  children: ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const touch = useRef<{ x: number; y: number; sideways: boolean | null } | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    const wide = window.matchMedia(DESKTOP);
    if (wide.matches) {
      window.location.reload();
      return;
    }
    // Turned into a larger screen while open: show the cart's page instead.
    const onChange = () => wide.matches && window.location.reload();
    wide.addEventListener("change", onChange);
    // Always as a modal, in the top layer over the header and bars. Next.js keeps a page
    // left by a link hidden, which takes the dialog out of the top layer; coming back
    // (the browser's back button) runs this again.
    const d = dialog.current;
    if (d?.open && !d.matches(":modal")) d.close();
    if (d && !d.open) d.showModal();
    closing.current = false;
    document.documentElement.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => {
      wide.removeEventListener("change", onChange);
      cancelAnimationFrame(frame);
      setOpen(false);
      d?.close();
      // Left by a link inside (a product, checkout): the page it leads to has no drawer.
      document.documentElement.style.overflow = "";
    };
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    setDrag(0);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => router.back(), reduced ? 0 : 300);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="cart-drawer-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="fixed inset-0 z-[100] m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent md:hidden"
    >
      <div
        aria-hidden="true"
        onClick={close}
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
          if (start.sideways) setDrag(Math.max(0, dx));
        }}
        onTouchEnd={() => {
          const width = panel.current?.offsetWidth ?? 300;
          touch.current = null;
          if (drag > width / 4) close();
          else setDrag(0);
        }}
        className={`fixed inset-y-0 right-0 flex w-[92%] max-w-md flex-col bg-background shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <h2 id="cart-drawer-title" className="text-xl font-heading">
            {title}
          </h2>
          <button type="button" onClick={close} className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
            <span className="sr-only">{labels.close}</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </dialog>
  );
}

/**
 * Opens the slide-out cart once something was added, on phones, when the
 * store has chosen so (`stores.open_cart_on_add`). `state` is the add
 * action's latest outcome; each new one is looked at once.
 */
export function useOpenCartAfterAdd(enabled: boolean, cartHref: string, outcome: { outcome: string }) {
  const router = useRouter();
  // Coming back to the page later runs effects again: the same outcome opens nothing.
  const seen = useRef(outcome);
  useEffect(() => {
    if (seen.current === outcome) return;
    seen.current = outcome;
    if (!enabled || (outcome.outcome !== "added" && outcome.outcome !== "capped")) return;
    if (window.matchMedia(DESKTOP).matches) return;
    router.push(cartHref);
  }, [enabled, cartHref, outcome, router]);
}
