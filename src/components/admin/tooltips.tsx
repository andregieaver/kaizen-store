"use client";

import { useEffect } from "react";

import { TIP_DELAY_MS, hasOwnName, placeTip, tipText } from "@/lib/tooltip";

/** The tip's element id, which a described element points to while it shows. */
const TIP_ID = "kz-admin-tip";
/** Elements whose title is their name, not a hint: never given a tip. */
const TITLED = "[title]:not(iframe):not(frame):not(link):not(style)";

/**
 * Every hint the admin writes as a `title` (PSI UX-10), shown as a tip on hover and on keyboard focus, which a native title never is: the
 * title is moved out while the tip shows (so the browser's own does not show as well) and put back after. An element named only by its
 * title keeps that name as an `aria-label` meanwhile; one with a name of its own is described by the tip (`aria-describedby`). Escape hides
 * it, and it stays while the pointer is over it (WCAG 2.2 1.4.13). Mounted once, in `AdminFrame`.
 */
export function AdminTooltips() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.id = TIP_ID;
    tip.setAttribute("role", "tooltip");
    tip.className = "pointer-events-auto fixed z-[1000] max-w-72 rounded-md bg-inverse px-2 py-1 text-xs leading-snug text-inverse-ink shadow-md";
    tip.hidden = true;
    document.body.append(tip);

    let current: HTMLElement | null = null;
    let showTimer: number | undefined;
    let hideTimer: number | undefined;

    const restore = (el: HTMLElement) => {
      const title = el.dataset.kzTitle;
      if (title !== undefined && !el.hasAttribute("title")) el.setAttribute("title", title);
      delete el.dataset.kzTitle;
      if (el.dataset.kzTipLabel) el.removeAttribute("aria-label");
      delete el.dataset.kzTipLabel;
      if (el.dataset.kzTipDescribed !== undefined) {
        const before = el.dataset.kzTipDescribed;
        if (before) el.setAttribute("aria-describedby", before);
        else el.removeAttribute("aria-describedby");
        delete el.dataset.kzTipDescribed;
      }
    };

    /** Hides the tip that shows, leaving a tip waiting to show for another element alone. */
    const hideShown = () => {
      window.clearTimeout(hideTimer);
      if (!current) return;
      restore(current);
      current = null;
      tip.hidden = true;
    };

    /** Hides the tip and cancels one waiting to show (Escape, a press, a scroll, leaving the field). */
    const hide = () => {
      window.clearTimeout(showTimer);
      hideShown();
    };

    const show = (el: HTMLElement) => {
      const text = tipText(el.getAttribute("title"));
      if (!text || !el.isConnected) return;
      hideShown();
      current = el;
      el.dataset.kzTitle = el.getAttribute("title") ?? "";
      el.removeAttribute("title");
      if (!hasOwnName(el)) {
        el.setAttribute("aria-label", text);
        el.dataset.kzTipLabel = "1";
      } else {
        const before = el.getAttribute("aria-describedby") ?? "";
        el.dataset.kzTipDescribed = before;
        el.setAttribute("aria-describedby", [before, TIP_ID].filter(Boolean).join(" "));
      }
      tip.textContent = text;
      tip.hidden = false;
      const box = el.getBoundingClientRect();
      const at = placeTip(box, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
      tip.style.top = `${at.top}px`;
      tip.style.left = `${at.left}px`;
    };

    const titledFrom = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? (target.closest<HTMLElement>(TITLED) ?? (current?.contains(target) ? current : null)) : null;

    const onOver = (event: PointerEvent) => {
      if (event.target instanceof Node && tip.contains(event.target)) {
        window.clearTimeout(hideTimer);
        return;
      }
      const el = titledFrom(event.target);
      if (el && el === current) {
        window.clearTimeout(hideTimer);
        return;
      }
      window.clearTimeout(showTimer);
      if (!el) return;
      showTimer = window.setTimeout(() => show(el), TIP_DELAY_MS);
    };

    const onOut = (event: PointerEvent) => {
      // Leaving an element cancels its waiting tip; pointing at the next one (the pointerover that follows) starts its own.
      window.clearTimeout(showTimer);
      const to = event.relatedTarget;
      if (!current || (to instanceof Node && (tip.contains(to) || current.contains(to)))) return;
      // A moment to cross the gap to the tip, which keeps it. Only the tip that shows goes, never one now waiting for the next element.
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hideShown, 120);
    };

    const onFocus = (event: FocusEvent) => {
      const el = event.target instanceof HTMLElement && event.target.matches(TITLED) ? event.target : null;
      if (el && el.matches(":focus-visible")) show(el);
    };

    const onBlur = (event: FocusEvent) => {
      if (current && event.target === current) hide();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && current) hide();
    };

    const onPress = () => hide();

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      tip.remove();
    };
  }, []);
  return null;
}
