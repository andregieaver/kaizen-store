/**
 * The admin's rail with its sections' names beside their icons (D262): a person's own choice, kept in this browser. It is an attribute
 * on `<html>`, set before the page is drawn by the admin's first script (`railNamesScript()`), so a page never opens narrow and then
 * widens; the rail's names and width follow it by CSS. Off unless chosen; where storage is blocked it lasts for the page.
 */

export const RAIL_NAMES_KEY = "kaizen_admin_rail";
/** The stored word, and the attribute's value, for a rail with names. */
export const RAIL_NAMES = "names";
export const RAIL_NAMES_ATTRIBUTE = "data-rail";
/** Told when the choice changes, so the rail's button follows. */
export const RAIL_NAMES_EVENT = "kaizen-rail-names";

/** The admin's first script: the stored choice onto `<html>`. */
export function railNamesScript(): string {
  return `(function(){try{if(localStorage.getItem(${JSON.stringify(RAIL_NAMES_KEY)})===${JSON.stringify(RAIL_NAMES)})document.documentElement.setAttribute(${JSON.stringify(RAIL_NAMES_ATTRIBUTE)},${JSON.stringify(RAIL_NAMES)});}catch(e){}})();`;
}

/** Whether the rail shows its names on this page. */
export const railNamesShown = (): boolean => document.documentElement.getAttribute(RAIL_NAMES_ATTRIBUTE) === RAIL_NAMES;

/** Shows or hides the rail's names, and keeps the choice in the browser (no stored value is the default, without names). */
export function setRailNames(on: boolean): void {
  const root = document.documentElement;
  if (on) root.setAttribute(RAIL_NAMES_ATTRIBUTE, RAIL_NAMES);
  else root.removeAttribute(RAIL_NAMES_ATTRIBUTE);
  try {
    if (on) localStorage.setItem(RAIL_NAMES_KEY, RAIL_NAMES);
    else localStorage.removeItem(RAIL_NAMES_KEY);
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
  window.dispatchEvent(new Event(RAIL_NAMES_EVENT));
}
