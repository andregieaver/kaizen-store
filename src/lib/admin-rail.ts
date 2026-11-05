/**
 * The admin's rail with its sections' names beside their icons (D262): a person's own choice, kept in this browser. It is an attribute
 * on `<html>`, set before the page is drawn by the admin's first script (`railNamesScript()`), so a page never opens narrow and then
 * widens; the rail's names and width follow it by CSS. Where storage is blocked it lasts for the page.
 *
 * With no choice made, the names are shown on a screen at least `RAIL_NAMES_WIDE` wide (D454): icons alone are recalled, names are
 * read, and a wide screen has the room. Narrowing it is kept as a choice (`RAIL_ICONS`), so it stays narrow.
 */

export const RAIL_NAMES_KEY = "kaizen_admin_rail";
/** The stored word, and the attribute's value, for a rail with names. */
export const RAIL_NAMES = "names";
/** The stored word for a rail narrowed to its icons by choice. */
export const RAIL_ICONS = "icons";
/** The screens on which the rail shows its names until the person narrows it. */
export const RAIL_NAMES_WIDE = "(min-width: 1280px)";
export const RAIL_NAMES_ATTRIBUTE = "data-rail";
/** Told when the choice changes, so the rail's button follows. */
export const RAIL_NAMES_EVENT = "kaizen-rail-names";

/** The admin's first script: the stored choice onto `<html>`. */
export function railNamesScript(): string {
  return `(function(){try{var v=localStorage.getItem(${JSON.stringify(RAIL_NAMES_KEY)});if(v===${JSON.stringify(RAIL_NAMES)}||(v===null&&typeof matchMedia==="function"&&matchMedia(${JSON.stringify(RAIL_NAMES_WIDE)}).matches))document.documentElement.setAttribute(${JSON.stringify(RAIL_NAMES_ATTRIBUTE)},${JSON.stringify(RAIL_NAMES)});}catch(e){}})();`;
}

/** Whether the rail shows its names on this page. */
export const railNamesShown = (): boolean => document.documentElement.getAttribute(RAIL_NAMES_ATTRIBUTE) === RAIL_NAMES;

/** Shows or hides the rail's names, and keeps the choice in the browser (no stored value is the default: names on a wide screen). */
export function setRailNames(on: boolean): void {
  const root = document.documentElement;
  if (on) root.setAttribute(RAIL_NAMES_ATTRIBUTE, RAIL_NAMES);
  else root.removeAttribute(RAIL_NAMES_ATTRIBUTE);
  try {
    localStorage.setItem(RAIL_NAMES_KEY, on ? RAIL_NAMES : RAIL_ICONS);
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
  window.dispatchEvent(new Event(RAIL_NAMES_EVENT));
}
