import { layersShow } from "./background-layers";
import type { MenuDrawer } from "./page-content";

/** Whether the drawer has a background of its own (a colour, picture or gradient, or layers over none). */
export const drawerHasBackground = (drawer: MenuDrawer | undefined): boolean =>
  Boolean(drawer?.background) || layersShow(drawer?.backgroundLayers) || Boolean(drawer?.backdropBlur);
