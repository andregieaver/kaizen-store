import { huedBackground } from "@/lib/background-layers";
import type { MenuDrawer } from "@/lib/page-content";

import { PartBackground } from "./page-parts";

/**
 * A phone drawer's own background (the menu's or the slide-out cart's, `MenuDrawer`): its colour, picture or gradient and the layers
 * over it, every colour turned by its hue, drawn still behind what the drawer holds. A colour is drawn here (a row's comes from the part
 * stylesheet), solid or see-through.
 */
export function DrawerBackground({ drawer }: { drawer: MenuDrawer }) {
  const colour = huedBackground(drawer.background, drawer.backgroundHue);
  return (
    <>
      {colour?.type === "color" && (
        <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundColor: colour.color, opacity: (colour.opacity ?? 100) / 100 }} />
      )}
      <PartBackground background={drawer.background} hue={drawer.backgroundHue} layers={drawer.backgroundLayers} stillLayers />
    </>
  );
}
