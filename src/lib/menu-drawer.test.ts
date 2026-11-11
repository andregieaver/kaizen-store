import { describe, expect, it } from "vitest";

import { CART_DRAWER_LOOK, DEFAULT_MENU_LOOK, drawerHasBackground, ownDrawer, menuDrag, menuDragCloses, menuLook, menuLookAttrs, menuLookFrom, menuOverlayClass, menuPanelClass, menuSwipe } from "./menu-drawer";
import { MENU_SIDES, MENU_TYPES, pageBlockSchema } from "./page-content";
import { headerDrawer, phoneMenuIds } from "./site-layout";
import { partCss } from "./part-css";
import { DEFAULT_BREAKPOINTS } from "./breakpoints";

const button = (drawer: unknown): unknown => ({ id: "b", type: "site", part: "menuButton", drawer });
const parse = (drawer: unknown) => pageBlockSchema.safeParse(button(drawer));
const drawerOf = (drawer: unknown) => {
  const block = pageBlockSchema.parse(button(drawer));
  return block.type === "site" ? block.drawer : undefined;
};

describe("the phone menu's look", () => {
  it("is a panel from the left unless a button says otherwise, and a dropdown always comes from the top", () => {
    expect(menuLook(undefined)).toEqual(DEFAULT_MENU_LOOK);
    expect(menuLook({ side: "right" })).toEqual({ type: "drawer", side: "right" });
    expect(menuLook({ type: "dropdown", side: "bottom" })).toEqual({ type: "dropdown", side: "top" });
  });

  it("is carried on the button's data attributes, none for the standard look, and anything unknown reads as the standard", () => {
    expect(menuLookAttrs(undefined)).toEqual({});
    expect(menuLookAttrs({ type: "card", side: "bottom" })).toEqual({ "data-menu-type": "card", "data-menu-side": "bottom" });
    expect(menuLookFrom({ menuType: "card", menuSide: "bottom" })).toEqual({ type: "card", side: "bottom" });
    expect(menuLookFrom({ menuType: "<script>", menuSide: "sideways" })).toEqual(DEFAULT_MENU_LOOK);
    expect(menuLookFrom({})).toEqual(DEFAULT_MENU_LOOK);
  });

  it("gives every kind and edge a place, a closed state off its own edge and an open state at rest", () => {
    for (const type of MENU_TYPES) {
      for (const side of MENU_SIDES) {
        const look = menuLook({ type, side });
        const closed = menuPanelClass(look, false);
        expect(menuPanelClass(look, true)).toContain("translate-x-0 translate-y-0 opacity-100");
        if (type === "dropdown") expect(closed).toContain("opacity-0");
        else expect(closed).toMatch(side === "left" || side === "right" ? /translate-x-/ : /translate-y-/);
      }
    }
    expect(menuPanelClass(menuLook({ side: "right" }), false)).toContain("right-0");
    expect(menuPanelClass(menuLook({ type: "card" }), true)).toContain("rounded-2xl");
    expect(menuPanelClass(menuLook({ type: "fullscreen" }), true)).toContain("inset-0");
    expect(menuOverlayClass(menuLook({ type: "dropdown" }))).toContain("top-(--menu-top)");
    expect(menuOverlayClass(DEFAULT_MENU_LOOK)).toBe("inset-0");
  });

  it("closes by a swipe back towards its edge, a quarter of its size, and never moves away from it", () => {
    expect(menuSwipe(menuLook({ side: "bottom" }))).toEqual({ axis: "y", sign: 1 });
    expect(menuSwipe(menuLook({ type: "dropdown" }))).toEqual({ axis: "y", sign: -1 });
    expect(menuDrag(DEFAULT_MENU_LOOK, -80, 5)).toBe(-80);
    expect(menuDrag(DEFAULT_MENU_LOOK, 80, 5)).toBe(0);
    expect(menuDrag(menuLook({ side: "right" }), 60, 0)).toBe(60);
    expect(menuDrag(menuLook({ side: "bottom" }), 0, 120)).toBe(120);
    expect(menuDragCloses(-80, 300)).toBe(true);
    expect(menuDragCloses(-60, 300)).toBe(false);
  });
});

describe("a menu button's drawer in the page", () => {
  it("keeps what is set, and nothing for a drawer with nothing set", () => {
    expect(drawerOf({})).toBeUndefined();
    expect(drawerOf({ side: "left" })).toEqual({ side: "left" });
    expect(drawerOf({ type: "card", side: "right", background: { type: "color", color: "#112233", opacity: 80 }, backdropBlur: 12 })).toEqual({ type: "card", side: "right", background: { type: "color", color: "#112233", opacity: 80 }, backdropBlur: 12 });
  });

  it("takes a column's backgrounds but no video, and refuses an unknown kind or edge", () => {
    expect(parse({ background: { type: "gradient", style: "shift", colors: ["#000000", "#ffffff"] } }).success).toBe(true);
    expect(parse({ background: { type: "video", video: { url: "https://example.com/a.mp4" }, overlay: null } }).success).toBe(false);
    expect(parse({ type: "popover" }).success).toBe(false);
    expect(parse({ side: "middle" }).success).toBe(false);
  });

  it("carries a background for the menu only when it has one", () => {
    expect(drawerHasBackground(undefined)).toBe(false);
    expect(drawerHasBackground({ type: "card" })).toBe(false);
    expect(drawerHasBackground({ background: { type: "color", color: "#000000" } })).toBe(true);
    expect(drawerHasBackground({ backdropBlur: 8 })).toBe(true);
  });
});

describe("the slide-out cart's look (D571)", () => {
  it("comes from the right unless set, and the builder keeps only what differs from each part's standard", () => {
    expect(menuLook(undefined, CART_DRAWER_LOOK)).toEqual({ type: "drawer", side: "right" });
    expect(menuLook({ side: "left" }, CART_DRAWER_LOOK)).toEqual({ type: "drawer", side: "left" });
    expect(ownDrawer({ type: "drawer", side: "right" }, CART_DRAWER_LOOK)).toBeUndefined();
    expect(ownDrawer({ type: "drawer", side: "left" }, CART_DRAWER_LOOK)).toEqual({ side: "left" });
    expect(ownDrawer({ type: "drawer", side: "left" }, DEFAULT_MENU_LOOK)).toBeUndefined();
    expect(ownDrawer({ type: "card", backgroundHue: undefined }, DEFAULT_MENU_LOOK)).toEqual({ type: "card" });
  });

  it("is a little wider than the menu from the left or right", () => {
    expect(menuPanelClass(CART_DRAWER_LOOK, true, true)).toContain("w-[92%] max-w-md");
    expect(menuPanelClass(menuLook({ type: "card" }, CART_DRAWER_LOOK), true, true)).toContain("w-[calc(92%-0.75rem)] max-w-md");
    expect(menuPanelClass(CART_DRAWER_LOOK, true)).toContain("w-[85%] max-w-sm");
  });

  it("is read from the header's Cart component, not the menu button's", () => {
    const site = (id: string, part: string, drawer?: unknown) => ({ id, type: "site", part, ...(drawer ? { drawer } : {}) });
    const header = {
      rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [site("m", "menuButton", { type: "fullscreen" }), site("k", "cart", { type: "card", side: "bottom" })] }] }],
    } as never;
    expect(headerDrawer(header, "cart")).toEqual({ type: "card", side: "bottom" });
    expect(headerDrawer(header, "menuButton")).toEqual({ type: "fullscreen" });
    expect(headerDrawer(null, "cart")).toBeUndefined();
  });
});

describe("the phone menu's links and the button's place (D573)", () => {
  const MENU_A = "00000000-0000-4000-8000-00000000000a";
  const MENU_B = "00000000-0000-4000-8000-00000000000b";
  const header = (blocks: unknown[]) => ({ rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }] }] }) as never;

  it("shows the header's Menu component's menu, else the site's header menu, and each menu a button chooses", () => {
    expect(phoneMenuIds(header([{ id: "m", type: "menu", menuId: MENU_A }]), MENU_B)).toEqual({ standard: MENU_A, chosen: [] });
    expect(phoneMenuIds(header([{ id: "m", type: "menu" }]), MENU_B)).toEqual({ standard: MENU_B, chosen: [] });
    expect(phoneMenuIds(null, null)).toEqual({ standard: null, chosen: [] });
    const both = header([
      { id: "m", type: "menu", menuId: MENU_A },
      { id: "b", type: "site", part: "menuButton", drawer: { menuId: MENU_B } },
      { id: "c", type: "site", part: "menuButton", drawer: { menuId: MENU_A } },
    ]);
    expect(phoneMenuIds(both, null)).toEqual({ standard: MENU_A, chosen: [MENU_B] });
    expect(pageBlockSchema.safeParse(button({ menuId: "not-a-menu" })).success).toBe(false);
  });

  it("moves the button to the end of its column it is set to, on the site", () => {
    const row = (align?: string) => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "b", type: "site", part: "menuButton", ...(align && { align }) }] }] }) as never;
    expect(partCss([row("right")], "site", DEFAULT_BREAKPOINTS)).toMatch(/order:\s*99;[^}]*margin-left:\s*auto/);
    expect(partCss([row("left")], "site", DEFAULT_BREAKPOINTS)).toMatch(/order:\s*-1;[^}]*margin-right:\s*auto/);
    expect(partCss([row()], "site", DEFAULT_BREAKPOINTS)).not.toMatch(/order:/);
  });
});
