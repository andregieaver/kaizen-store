/**
 * The docs' search shortcut (wave 14 unit E1, D442), the seam for the search itself (unit E3): pure and tiny, as the top bar's script
 * imports it.
 */

/** Whether a key press asks for the docs' search: ⌘K or Ctrl+K anywhere, `/` outside a field. */
export function isSearchShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, inField: boolean): boolean {
  if (event.altKey) return false;
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") return true;
  return event.key === "/" && !event.metaKey && !event.ctrlKey && !inField;
}

/** Said on `window` when the reader asks for the search (⌘K): the search dialog (unit E3) listens for it. */
export const DOCS_SEARCH_EVENT = "kaizen:docs-search";
