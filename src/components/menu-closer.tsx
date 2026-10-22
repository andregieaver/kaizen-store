"use client";

import { useEffect } from "react";

let listening = false;

/**
 * Closes a side-by-side menu's open list or mega menu once one of its links is pressed. The lists open on hover and on
 * focus inside them (CSS only), and a page reached by a link in the browser keeps the header: the pressed link would keep
 * the focus and the pointer still lies over it, so the panel would stay open over the new page. A press marks its item
 * shut (`data-menu-shut`, which globals.css hides the panel under) and lets go of the focus; the mark goes when the pointer
 * leaves the item or the focus comes back into it, so the menu opens again as ever. One listener on the document serves
 * every menu on the page.
 */
export function MenuCloser() {
  useEffect(() => {
    if (listening) return;
    listening = true;
    const itemOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-menu-item]") : null);
    const press = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      const item = link && itemOf(link);
      if (!item || !item.querySelector("[data-menu-panel]")) return;
      item.setAttribute("data-menu-shut", "");
      if (document.activeElement instanceof HTMLElement && item.contains(document.activeElement)) document.activeElement.blur();
    };
    const leave = (event: PointerEvent) => {
      const item = itemOf(event.target);
      if (item?.hasAttribute("data-menu-shut") && !(event.relatedTarget instanceof Node && item.contains(event.relatedTarget))) {
        item.removeAttribute("data-menu-shut");
      }
    };
    const enter = (event: FocusEvent) => itemOf(event.target)?.removeAttribute("data-menu-shut");
    document.addEventListener("click", press);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    return () => {
      listening = false;
      document.removeEventListener("click", press);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
    };
  }, []);
  return null;
}
