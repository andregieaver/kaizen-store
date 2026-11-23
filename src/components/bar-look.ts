/**
 * Copies the slide-out menu's look onto the phone's bottom bar (`HidingBottomBar` in `store-chrome.tsx`, in the same chunk: a chunk
 * of its own would be one more late script on every store page, and the admin no longer loads that file): the header menu button's data attributes onto the bar's own Menu button, and the
 * background it carries for the menu (`DrawerLook`) behind the bar. Answers the colour set and blur the bar takes with it.
 */

/** Where the phone's menu buttons are that the bottom bar takes its look from: the site's header, or a page's own (never a bar's). */
function headerMenuButton(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("[data-open-menu]")).filter(
    (button) => !button.closest("[data-default-bar], [data-product-bar], #store-menu"),
  );
  // A header hidden on this page (one of its own in its place) has its buttons out of the layout.
  return buttons.find((button) => button.getClientRects().length > 0) ?? buttons[0] ?? null;
}

/** The data attributes of a menu button that say how the menu opens from it (`menuLookAttrs()`, `data-menu-look`, `data-menu-nav`). */
const OPENER_DATA = ["menuType", "menuSide", "menuLook", "menuNav"] as const;

export function copyMenuLook(bar: HTMLElement, background: HTMLElement | null): { own: boolean; surface: string; blur: number } {
  const opener = headerMenuButton();
  for (const button of Array.from(bar.querySelectorAll<HTMLElement>("[data-open-menu]"))) {
    for (const key of OPENER_DATA) {
      const value = opener?.dataset[key];
      if (value) button.dataset[key] = value;
      else delete button.dataset[key];
    }
  }
  const holder = opener?.dataset.menuLook ? document.getElementById(opener.dataset.menuLook) : null;
  // Copied once the page is drawn: the background a header carries for its menu is only in the document then.
  background?.replaceChildren(...(holder ? Array.from((holder.cloneNode(true) as HTMLElement).childNodes) : []));
  return { own: Boolean(holder), surface: holder?.dataset.menuSurface ?? "", blur: Number(holder?.dataset.menuBlur) || 0 };
}
