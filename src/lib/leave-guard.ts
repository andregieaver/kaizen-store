/**
 * Whether leaving an editor with unsaved work asks first (code review 1.16, D787): the pure decisions behind `useLeaveGuard`
 * (`src/components/admin/leave-guard.tsx`), which hears a click and the browser's Back on the window, before Next's links and router do.
 */

/** What a click was: which button and keys, and whether something already took it. */
export type ClickFacts = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** The link clicked: where to, in which window, whether it downloads, and whether it says it leaves without saving (`data-leave-anyway`). */
export type LinkFacts = { href: string; target: string; download: boolean; leaveAnyway: boolean };

function url(address: string, base: string): URL | null {
  try {
    return new URL(address, base);
  } catch {
    return null;
  }
}

/** The same page: the same address but for a `#part` of it, which moves within the page and leaves nothing. */
function samePage(a: URL, b: URL): boolean {
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
}

/**
 * What a click on a link does with unsaved work: `ask` first when it would take the person to another page of the admin, `release`
 * when the link itself says it leaves without saving (nothing more is asked, not even by the browser), and `pass` for everything
 * the browser does on its own: a new tab or window, a download, a modified click, a part of this page, another site or scheme (a
 * whole page load to another site is the browser's own question, `beforeunload`).
 */
export function clickLeaves(click: ClickFacts, link: LinkFacts, here: string): "ask" | "release" | "pass" {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return "pass";
  if ((link.target !== "" && link.target !== "_self") || link.download) return "pass";
  const to = url(link.href, here);
  const from = url(here, here);
  if (!to || !from || (to.protocol !== "http:" && to.protocol !== "https:")) return "pass";
  if (link.leaveAnyway) return "release";
  if (to.origin !== from.origin || samePage(to, from)) return "pass";
  return "ask";
}

/** Whether the browser's Back or Forward took the person off the editor's page (`now`), rather than to a part of it or back to it. */
export function popLeaves(now: string, editor: string): boolean {
  const to = url(now, editor);
  const from = url(editor, editor);
  return to !== null && from !== null && !samePage(to, from);
}
