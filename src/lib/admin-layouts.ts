/**
 * The admin's layouts (docs/admin-style.md section 6): a layout is a named arrangement of the shell's regions, chosen by the level
 * (and later by a page within it). `AdminFrame` reads the layout and draws only its regions: a region a layout leaves out is not
 * rendered, so its links are never in the page twice. Pure, so the browser and the tests can read it.
 */

export const ADMIN_REGIONS = ["rail", "sidebar", "topbar", "tabs", "main", "panel"] as const;
export type AdminRegion = (typeof ADMIN_REGIONS)[number];

export type AdminLayout = {
  id: string;
  name: string;
  /** The regions it draws on a computer. A phone draws every layout the same way: the top bar and the slide-out menu. */
  regions: readonly AdminRegion[];
  /** What it is for, in a sentence. */
  for: string;
};

export const ADMIN_LAYOUTS = [
  {
    id: "classic",
    name: "Classic",
    regions: ["topbar", "tabs", "sidebar", "main", "panel"],
    for: "The admin as it was (D107): the level switcher and the sections as tabs in the top bar, a section's pages in a sidebar.",
  },
  {
    id: "rail",
    name: "Rail",
    // The sidebar is drawn only for a section that has pages of its own (the `rail-sidebar` arrangement of 6.3); the rail picks the section.
    regions: ["rail", "topbar", "sidebar", "main", "panel"],
    for: "The reference: the sections as icons in a dark rail, a plain top bar with the switcher and the account, a section's pages beside.",
  },
  {
    id: "focus",
    name: "Focus",
    // Drawn by `FocusFrame`, not `AdminFrame`: the pages before a person is let in, where no level's sections exist yet.
    regions: ["topbar", "main"],
    for: "One task on its own: Kaizen's mark in a plain top bar and one card on the canvas. The sign-in, two-step, password and consent pages.",
  },
] as const satisfies readonly AdminLayout[];

export type AdminLayoutId = (typeof ADMIN_LAYOUTS)[number]["id"];

export const ADMIN_LEVELS = ["platform", "control", "store", "hosting"] as const;
export type AdminLevel = (typeof ADMIN_LEVELS)[number];

/**
 * The layout each level is drawn in (docs/admin-style.md section 8): the store's, the platform's and the owner's are the rail (D219);
 * hosting, a single page with no sections, stays classic.
 */
export const LEVEL_LAYOUTS: Record<AdminLevel, AdminLayoutId> = {
  platform: "rail",
  control: "rail",
  store: "rail",
  hosting: "classic",
};

export const adminLayout = (id: AdminLayoutId): AdminLayout => ADMIN_LAYOUTS.find((l) => l.id === id) ?? ADMIN_LAYOUTS[0];

/** Whether a layout draws a region. */
export const draws = (id: AdminLayoutId, region: AdminRegion): boolean => adminLayout(id).regions.includes(region);
