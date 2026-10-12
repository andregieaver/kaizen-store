"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { isCurrentPath } from "@/lib/menu-hover";

/**
 * A menu's hover and active marker (D207), placed inside the menu's `.kz-menu` box. It marks the link of the page shown
 * (`aria-current="page"`, `data-active`: in the browser, so a cached page is the same for all) and, for a menu whose
 * marker glides, moves the one marker (`.kz-mi-ind`) to the link under the pointer or focus, back to the page's link
 * when it leaves (or out of sight with none). Without script the links still answer the pointer: `data-mh-ready` is set
 * here, and until then the CSS grows the effect on each link instead.
 */
export function MenuGlide({ slide, preview = false }: { slide: boolean; /** In the builder: the links keep the active mark they were drawn with. */ preview?: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const box = marker.current?.parentElement;
    if (!box) return;
    const links = () => Array.from(box.querySelectorAll<HTMLAnchorElement>(":scope .kz-mi > a"));
    let active: HTMLAnchorElement | null = preview ? box.querySelector<HTMLAnchorElement>(":scope .kz-mi > a[data-active]") : null;
    if (!preview) for (const link of links()) {
      const here = isCurrentPath(link.getAttribute("href") ?? "", window.location.pathname, window.location.origin);
      link.toggleAttribute("data-active", here);
      if (here) link.setAttribute("aria-current", "page");
      else if (link.getAttribute("aria-current") === "page") link.removeAttribute("aria-current");
      if (here && !active) active = link;
    }
    if (!slide) return;
    const ind = marker.current!;
    const withActive = box.hasAttribute("data-mh-active");
    let on: HTMLAnchorElement | null = null;
    const place = (link: HTMLAnchorElement | null) => {
      if (on && on !== link) on.removeAttribute("data-mi-on");
      if (!link) {
        ind.removeAttribute("data-shown");
        on = null;
        return;
      }
      const outer = box.getBoundingClientRect();
      const rect = link.getBoundingClientRect();
      // The first time it shows it appears in place; after that it glides.
      const jump = !ind.hasAttribute("data-shown");
      if (jump) ind.setAttribute("data-jump", "");
      ind.style.setProperty("--mi-x", `${rect.left - outer.left}px`);
      ind.style.setProperty("--mi-y", `${rect.top - outer.top}px`);
      ind.style.setProperty("--mi-w", `${rect.width}px`);
      ind.style.setProperty("--mi-h", `${rect.height}px`);
      if (jump) {
        void ind.offsetWidth;
        ind.removeAttribute("data-jump");
      }
      ind.setAttribute("data-shown", "");
      link.setAttribute("data-mi-on", "");
      on = link;
    };
    const rest = () => place(withActive ? active : null);
    const topLink = (target: EventTarget | null) => {
      const item = target instanceof Element ? target.closest(".kz-mi") : null;
      return item && box.contains(item) ? item.querySelector<HTMLAnchorElement>(":scope > a") : null;
    };
    const over = (event: Event) => {
      const link = topLink(event.target);
      if (link) place(link);
    };
    const out = (event: FocusEvent) => {
      if (!box.contains(event.relatedTarget as Node | null)) rest();
    };
    box.addEventListener("pointerover", over);
    box.addEventListener("focusin", over);
    box.addEventListener("pointerleave", rest);
    box.addEventListener("focusout", out);
    // Links move when the line wraps or fonts arrive: the marker follows the link it is on.
    const resize = new ResizeObserver(() => {
      if (!on) return;
      const link = on;
      on = null;
      ind.removeAttribute("data-shown");
      place(link);
    });
    resize.observe(box);
    box.setAttribute("data-mh-ready", "");
    rest();
    return () => {
      box.removeEventListener("pointerover", over);
      box.removeEventListener("focusin", over);
      box.removeEventListener("pointerleave", rest);
      box.removeEventListener("focusout", out);
      resize.disconnect();
      box.removeAttribute("data-mh-ready");
      on?.removeAttribute("data-mi-on");
    };
  }, [pathname, slide, preview]);

  return <span ref={marker} className="kz-mi-ind" aria-hidden="true" />;
}
