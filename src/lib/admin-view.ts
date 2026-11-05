/**
 * Basic and Advanced (D454, `docs/audits/admin-usability-2026-11.md`): how much of a store's navigation a person is shown. Basic, the
 * default, is Homer's: each section's everyday pages, the rest one deliberate press away. Advanced is Lisa's: every page. It is the
 * account's own choice (`accounts.admin_view`), so it follows the person to every device and store.
 *
 * Basic hides links, never pages: an address, a link from Home, the setup checklist or the AI manager still opens any page, and the
 * sidebar then shows that page where it lives (`shownIn()`), so nobody lands somewhere the navigation does not admit to.
 */

export const ADMIN_VIEWS = ["basic", "advanced"] as const;
export type AdminView = (typeof ADMIN_VIEWS)[number];

/** Everyone starts in Basic; Advanced is a choice. */
export const DEFAULT_ADMIN_VIEW: AdminView = "basic";

export const isAdminView = (value: unknown): value is AdminView => typeof value === "string" && (ADMIN_VIEWS as readonly string[]).includes(value);

/** The stored word as a view: the default for anything else (a column read before its migration, a typo). */
export const adminViewOf = (stored: unknown): AdminView => (isAdminView(stored) ? stored : DEFAULT_ADMIN_VIEW);

/** A link the navigation can leave out of Basic. */
export type ViewItem = { advanced?: boolean };

/**
 * Whether a link is drawn: always in Advanced; in Basic, a link not marked advanced, or the page being viewed (or one inside it), so a
 * person who followed a link to an advanced page still sees where they are.
 */
export const shownIn = (view: AdminView, item: ViewItem, current: boolean): boolean => view === "advanced" || !item.advanced || current;

/** How many of these links Basic leaves out, for the line that says there is more. */
export const hiddenIn = <T extends ViewItem>(view: AdminView, items: readonly T[], isCurrent: (item: T) => boolean = () => false): number =>
  items.filter((item) => !shownIn(view, item, isCurrent(item))).length;
