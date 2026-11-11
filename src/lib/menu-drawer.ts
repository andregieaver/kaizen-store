/**
 * The phone's menu as a menu button opens it: its kind (a panel from an edge, the whole screen, a panel dropping under the header or
 * a floating card) and the edge it comes in from. The menu itself is one dialog per page (`MobileMenu`); the button that opens it says
 * how, on `data-menu-type` and `data-menu-side`, so a header built in the page builder can give it its own look while the bottom bar's
 * Menu and the standard header open it as before (a panel from the left). Pure: visitors' pages read it.
 */

import { layersShow } from "./background-layers";
import { MENU_SIDES, MENU_TYPES, type MenuDrawer, type MenuSide, type MenuType } from "./page-content";

export type MenuLook = { type: MenuType; side: MenuSide };

export const DEFAULT_MENU_LOOK: MenuLook = { type: "drawer", side: "left" };

/** The look a button's settings give: a dropdown always comes from under the header, so its side is the top. */
export function menuLook(drawer: Pick<MenuDrawer, "type" | "side"> | undefined): MenuLook {
  const type = drawer?.type ?? DEFAULT_MENU_LOOK.type;
  return { type, side: type === "dropdown" ? "top" : (drawer?.side ?? DEFAULT_MENU_LOOK.side) };
}

/** The look a button asks for on its data attributes; anything unknown is the standard one. */
export function menuLookFrom(data: { menuType?: string; menuSide?: string }): MenuLook {
  const type = (MENU_TYPES as readonly string[]).includes(data.menuType ?? "") ? (data.menuType as MenuType) : undefined;
  const side = (MENU_SIDES as readonly string[]).includes(data.menuSide ?? "") ? (data.menuSide as MenuSide) : undefined;
  return menuLook({ type, side });
}

/** The data attributes a button gives for its look; none for the standard one. */
export function menuLookAttrs(drawer: MenuDrawer | undefined): Record<string, string> {
  const look = menuLook(drawer);
  return {
    ...(look.type !== DEFAULT_MENU_LOOK.type && { "data-menu-type": look.type }),
    ...(look.side !== DEFAULT_MENU_LOOK.side && { "data-menu-side": look.side }),
  };
}

// Every class written out whole, so Tailwind finds each.
const PLACE: Record<MenuType, Record<MenuSide, { at: string; closed: string }>> = {
  drawer: {
    left: { at: "inset-y-0 left-0 w-[85%] max-w-sm", closed: "-translate-x-full" },
    right: { at: "inset-y-0 right-0 w-[85%] max-w-sm", closed: "translate-x-full" },
    top: { at: "inset-x-0 top-0 max-h-[85dvh] rounded-b-2xl", closed: "-translate-y-full" },
    bottom: { at: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl", closed: "translate-y-full" },
  },
  fullscreen: {
    left: { at: "inset-0", closed: "-translate-x-full" },
    right: { at: "inset-0", closed: "translate-x-full" },
    top: { at: "inset-0", closed: "-translate-y-full" },
    bottom: { at: "inset-0", closed: "translate-y-full" },
  },
  card: {
    left: { at: "inset-y-3 left-3 w-[calc(85%-0.75rem)] max-w-sm rounded-2xl", closed: "-translate-x-[calc(100%+1.5rem)]" },
    right: { at: "inset-y-3 right-3 w-[calc(85%-0.75rem)] max-w-sm rounded-2xl", closed: "translate-x-[calc(100%+1.5rem)]" },
    top: { at: "inset-x-3 top-3 max-h-[calc(85dvh-0.75rem)] rounded-2xl", closed: "-translate-y-[calc(100%+1.5rem)]" },
    bottom: { at: "inset-x-3 bottom-3 max-h-[calc(85dvh-0.75rem)] rounded-2xl", closed: "translate-y-[calc(100%+1.5rem)]" },
  },
  // Under the header (`--menu-top`, measured as it opens), as wide as the screen and as tall as its links; it fades down into place.
  dropdown: Object.fromEntries(
    MENU_SIDES.map((side) => [
      side,
      { at: "inset-x-0 top-(--menu-top) max-h-[calc(100dvh-var(--menu-top))] rounded-b-2xl", closed: "-translate-y-4 opacity-0" },
    ]),
  ) as Record<MenuSide, { at: string; closed: string }>,
};

/** The panel's place and size, and how it looks while closed (it moves to `translate-0` and full opacity as it opens). */
export function menuPanelClass(look: MenuLook, open: boolean): string {
  const place = PLACE[look.type][look.side];
  return `${place.at} ${open ? "translate-x-0 translate-y-0 opacity-100" : place.closed}`;
}

/** The dimmed page behind it: under the header for a dropdown, so the header stays as it was. */
export const menuOverlayClass = (look: MenuLook): string => (look.type === "dropdown" ? "inset-x-0 bottom-0 top-(--menu-top)" : "inset-0");

/**
 * Which way a swipe closes the menu: towards the edge it came from. A swipe across a panel from the left or right closes it anywhere on
 * it; one up or down only from its top bar, so the links can still be scrolled.
 */
export function menuSwipe(look: MenuLook): { axis: "x" | "y"; sign: -1 | 1 } {
  switch (look.side) {
    case "left":
      return { axis: "x", sign: -1 };
    case "right":
      return { axis: "x", sign: 1 };
    case "top":
      return { axis: "y", sign: -1 };
    case "bottom":
      return { axis: "y", sign: 1 };
  }
}

/** How far a swipe has moved the panel: only towards its edge, never away from it. */
export function menuDrag(look: MenuLook, dx: number, dy: number): number {
  const { axis, sign } = menuSwipe(look);
  const moved = axis === "x" ? dx : dy;
  return sign < 0 ? Math.min(0, moved) : Math.max(0, moved);
}

/** Whether a drag has gone far enough to close it: a quarter of the panel's size along the swipe. */
export const menuDragCloses = (drag: number, size: number): boolean => Math.abs(drag) > size / 4;

/** Whether the drawer has a background of its own (a colour, picture or gradient, or layers over none). */
export const drawerHasBackground = (drawer: MenuDrawer | undefined): boolean =>
  Boolean(drawer?.background) || layersShow(drawer?.backgroundLayers) || Boolean(drawer?.backdropBlur);
