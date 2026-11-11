"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CART_DRAWER_LOOK, type MenuLook } from "@/lib/menu-drawer";

import { DrawerPanel } from "./drawer-panel";

const DESKTOP = "(min-width: 768px)";

/**
 * The slide-out cart on phones: the cart, opened over the page the shopper
 * was on (the intercepted `/cart`, `@drawer/(.)cart`). Closing goes back to
 * that page. On larger screens the cart is a page of its own, so there the
 * address, which is already the cart's, is loaded as one. It lies as the
 * header's Cart component says (D571, `src/lib/menu-drawer.ts`): a side panel
 * from the right unless set, the whole screen, under the header or a floating
 * card, on its own background (`background`, with `surface` and `blur`).
 */
export function CartDrawer({
  title,
  labels,
  look = CART_DRAWER_LOOK,
  surface,
  blur,
  background,
  children,
}: {
  title: string;
  labels: { close: string };
  look?: MenuLook;
  surface?: string;
  blur?: number;
  background?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
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
    // Under the header (a dropdown): from the bottom of the page's header as it is now, the top of the screen if it has slid away.
    const header = document.querySelector("header");
    d?.style.setProperty("--menu-top", `${header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0}px`);
    if (d?.open && !d.matches(":modal")) d.close();
    if (d && !d.open) d.showModal();
    closing.current = false;
    document.documentElement.style.overflow = "hidden";
    // Drawn closed first, then opened, so it moves in from its own edge.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setOpen(true));
    });
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
      onClick={(event) => {
        // A tap beside a dropdown, on the header it hangs from, closes it.
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-[100] m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent md:hidden"
    >
      <DrawerPanel
        look={look}
        open={open}
        wide
        surface={surface}
        blur={blur}
        background={background}
        bar={
          <h2 id="cart-drawer-title" className="text-xl font-heading">
            {title}
          </h2>
        }
        closeLabel={labels.close}
        onClose={close}
        bodyClassName="px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        {children}
      </DrawerPanel>
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
