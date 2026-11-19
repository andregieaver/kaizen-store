import { clickLeaves, LEAVE_POP, popLeaves } from "@/lib/leave-guard";

declare global {
  interface Window {
    /** The guard's `popstate` listener, which the admin's first script calls (`leavePopScript()`), and whether that script ran. */
    [LEAVE_POP]?: (event: PopStateEvent) => void;
    __kaizenLeavePopFirst?: number;
  }
}

/**
 * The leave guard's listeners (code review 1.16, D787), one set for every editor on screen (`useLeaveGuard` in `leave-guard.tsx`).
 * While an editor that holds changes not saved is registered, leaving is held and asked about:
 * - the browser's own leaving (closing the tab, reloading, another site): `beforeunload`, the browser's own question;
 * - a click on a link in the admin (the menu, breadcrumbs, any Next link or plain anchor): a click listener on the window, in its
 *   capture phase, hears it before React and Next's link do and holds it (`preventDefault`, `stopPropagation`); leaving clicks the
 *   same link again, so it goes where and how it would have. (Next's `onNavigate` would mean changing every link of the admin, and
 *   misses plain anchors.) A link that itself says it leaves without saving carries `data-leave-anyway` and is let go;
 * - Back and Forward: the Navigation API's `navigate` event comes before anything moves, and a traversal it says may be cancelled is
 *   cancelled; leaving traverses to the same entry. Where there is no Navigation API, or the browser will not let it be cancelled, a
 *   `popstate` listener keeps the editor on screen, if it runs before the router's: browsers call a window's listeners in the order
 *   they were added, capture or not, so the admin's first script adds one before any of Next's scripts run (`leavePopScript()` in
 *   `src/app/admin/layout.tsx`) and hands each event to this module. Staying then puts the editor's address back; leaving hands the
 *   router the move it held.
 */

export type Held =
  | { kind: "link"; anchor: HTMLAnchorElement; href: string }
  | { kind: "traverse"; key: string }
  | { kind: "back" }
  | { kind: "call"; go: () => void };
export type Guard = { links: boolean; ask: (held: Held | null) => void };

const guards = new Set<{ current: Guard | null }>();
/** What runs when a leave is chosen on purpose: the drafts kept in the browser go with the changes (`useBrowserDraft`). */
const onLeave = new Set<() => void>();
/** A leave chosen on purpose passes every listener for this long, the time it takes the browser or the router to start it. */
const LEAVE_MS = 3000;
let leavingUntil = 0;
/** The editor's entry in the browser's history, put back when a Back held by `popstate` is answered with Keep editing. */
let entry: { href: string; state: unknown } | null = null;
/** A Back or Forward is held by `popstate`: the address shows where it went while the editor stays on screen. */
let popHeld = false;

const leaving = () => Date.now() < leavingUntil;

function leaveOnPurpose() {
  leavingUntil = Date.now() + LEAVE_MS;
  for (const run of onLeave) run();
}

/** The first editor on screen whose changes a link or Back would lose, if any. */
export function asker(): Guard | null {
  for (const guard of guards) if (guard.current?.links) return guard.current;
  return null;
}

function remember() {
  if (!popHeld) entry = { href: window.location.href, state: window.history.state };
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!leaving()) event.preventDefault();
}

function onClick(event: MouseEvent) {
  if (leaving() || popHeld) return;
  remember();
  const guard = asker();
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!guard || !(anchor instanceof HTMLAnchorElement)) return;
  const link = { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download"), leaveAnyway: anchor.hasAttribute("data-leave-anyway") };
  const outcome = clickLeaves(event, link, window.location.href);
  if (outcome === "release") leaveOnPurpose();
  if (outcome !== "ask") return;
  event.preventDefault();
  event.stopPropagation();
  guard.ask({ kind: "link", anchor, href: anchor.href });
}

function onNavigate(event: NavigateEvent) {
  if (leaving() || event.navigationType !== "traverse" || !event.cancelable) return;
  const guard = asker();
  if (!guard || !popLeaves(event.destination.url, window.location.href)) return;
  event.preventDefault();
  guard.ask({ kind: "traverse", key: event.destination.key });
}

function onPopState(event: PopStateEvent) {
  if (leaving() || entry === null) return;
  const guard = asker();
  if (!guard) return;
  if (!popLeaves(window.location.href, entry.href)) {
    // Back on the editor's own address (Forward after a held Back): nothing is left, and the question goes.
    if (popHeld) {
      popHeld = false;
      event.stopImmediatePropagation();
      guard.ask(null);
    }
    return;
  }
  event.stopImmediatePropagation();
  popHeld = true;
  guard.ask({ kind: "back" });
}

// Handed to the listener the admin's first script added before the router's (see the top of this file); without that script, added
// here, later. It does nothing while no editor is dirty.
if (typeof window !== "undefined") {
  window[LEAVE_POP] = onPopState;
  if (!window.__kaizenLeavePopFirst) window.addEventListener("popstate", onPopState, true);
}

/** Registers a dirty editor; returns the way to unregister it. The listeners are on while any editor is registered. */
export function register(guard: { current: Guard | null }): () => void {
  if (guards.size === 0) {
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    window.navigation?.addEventListener("navigate", onNavigate);
  }
  guards.add(guard);
  remember();
  return () => {
    guards.delete(guard);
    if (guards.size > 0) return;
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("click", onClick, true);
    window.navigation?.removeEventListener("navigate", onNavigate);
    popHeld = false;
    entry = null;
  };
}

/** The person's answer to what was held: stay (the address put back after a Back held late) or leave the way they set out to. */
export function settle(held: Held, leave: boolean, push: (href: string) => void) {
  if (held.kind === "back") {
    if (!popHeld) return;
    popHeld = false;
    if (!leave) {
      // The entry as the router wrote it (`__NA`), which Next's history patch passes through without moving the router; an entry it did
      // not write would be read as a move, so then the browser steps forward to the editor again.
      if (entry && (entry.state as { __NA?: unknown } | null)?.__NA) window.history.pushState(entry.state, "", entry.href);
      else window.history.forward();
      return;
    }
    leaveOnPurpose();
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    return;
  }
  if (!leave) return;
  leaveOnPurpose();
  if (held.kind === "traverse") {
    // The entry it was going to may have gone meanwhile: then one step back.
    const navigation = window.navigation as Navigation | undefined;
    if (!navigation) return window.history.back();
    const moved = navigation.traverseTo(held.key);
    moved.committed?.catch(() => undefined);
    moved.finished?.catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "InvalidStateError") window.history.back();
    });
  } else if (held.kind === "call") held.go();
  else if (held.anchor.isConnected) held.anchor.click();
  else push(held.href);
}

/** Runs `then` when the person leaves on purpose; returns the way to stop. */
export function whenLeaving(then: () => void): () => void {
  onLeave.add(then);
  return () => {
    onLeave.delete(then);
  };
}
