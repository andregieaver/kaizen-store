"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { clickLeaves, popLeaves } from "@/lib/leave-guard";

/**
 * One leave guard for every editor (code review 1.16, D787; the admin usability audit's H1 row). While an editor holds changes not
 * saved, leaving asks first, however it is left:
 * - the browser's own leaving (closing the tab, reloading, another site): `beforeunload`, the browser's own question;
 * - a click on a link in the admin (the menu, breadcrumbs, any Next link or plain anchor): a click listener on the window, in its capture
 *   phase, hears it before React and Next's link do, holds it (`preventDefault`, `stopPropagation`) and asks in the admin's own
 *   dialog; *Leave without saving* clicks the same link again, so it goes where and how it would have. (Next's `onNavigate` would mean
 *   changing every link of the admin, and misses plain anchors.) A link that itself says it leaves without saving carries
 *   `data-leave-anyway`, and is let go without a question;
 * - the browser's Back and Forward: a `popstate` listener in the capture phase runs before the router's own and keeps the editor on
 *   screen; *Keep editing* puts the editor's address back, *Leave without saving* hands the router the move it held.
 * An editor's own moves (a `router.push` after a choice) ask through `leave()`. Nothing is asked after a save or when nothing changed:
 * an editor registers only while it is dirty. Two editors on one screen (a dual page) share the listeners and one question. The
 * dialog's code (`leave-dialogs.tsx`) is loaded once an editor has changes, never with its first scripts.
 */

type Held = { kind: "link"; anchor: HTMLAnchorElement; href: string } | { kind: "back" } | { kind: "call"; go: () => void };
type Guard = { links: boolean; ask: (held: Held | null) => void };

const guards = new Set<{ current: Guard | null }>();
/** What runs when a leave is chosen on purpose: the drafts kept in the browser go with the changes (`useBrowserDraft`). */
const onLeave = new Set<() => void>();
/** A leave chosen on purpose passes every listener for this long, the time it takes the browser or the router to start it. */
const LEAVE_MS = 3000;
let leavingUntil = 0;
/** The editor's entry in the browser's history, put back when a held Back is answered with Keep editing. */
let entry: { href: string; state: unknown } | null = null;
/** A Back or Forward is held: the address shows where it went while the editor stays on screen. */
let popHeld = false;

const leaving = () => Date.now() < leavingUntil;

function leaveOnPurpose() {
  leavingUntil = Date.now() + LEAVE_MS;
  for (const run of onLeave) run();
}

/** The first editor on screen whose changes a link or Back would lose. */
function asker(): Guard | null {
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

function register(guard: { current: Guard | null }): () => void {
  if (guards.size === 0) {
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState, true);
  }
  guards.add(guard);
  remember();
  return () => {
    guards.delete(guard);
    if (guards.size > 0) return;
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("popstate", onPopState, true);
    popHeld = false;
    entry = null;
  };
}

/** The person's answer to what was held: stay (the address put back after a held Back) or leave the way they set out to. */
function settle(held: Held, leave: boolean, push: (href: string) => void) {
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
  if (held.kind === "call") held.go();
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

type Dialogs = typeof import("./leave-dialogs");
let loaded: Dialogs | null = null;
let loading: Promise<Dialogs> | null = null;

function loadDialogs(): Promise<Dialogs> {
  loading ??= import("./leave-dialogs").then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The dialogs' module once `needed`, loaded on the way. */
function useDialogs(needed: boolean): Dialogs | null {
  const [dialogs, setDialogs] = useState<Dialogs | null>(null);
  useEffect(() => {
    if (!needed || dialogs) return;
    let live = true;
    loadDialogs().then(
      (module) => {
        if (live) setDialogs(module);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [needed, dialogs]);
  return dialogs ?? (needed ? loaded : null);
}

/**
 * Asks before changes not saved are left (see the top of this file). `dirty`: the editor holds changes; `links`, where it differs, whether
 * a link or Back would lose them (an editor that saves by itself has them saved on its way out, and asks only when a save failed).
 * Draw `dialog`; ask before an editor's own move with `leave(go)`.
 */
export function useLeaveGuard(dirty: boolean, { links = dirty }: { links?: boolean } = {}): { dialog: ReactNode; leave: (go: () => void) => void } {
  const router = useRouter();
  const [held, setHeld] = useState<Held | null>(null);
  const dialogs = useDialogs(dirty || held !== null);
  const guard = useRef<Guard | null>(null);
  useEffect(() => {
    guard.current = {
      links,
      ask: (next) => {
        setHeld(next);
        // Without its dialog (the network gone), nothing is lost: the editor stays where it is.
        if (next) loadDialogs().catch(() => {
          setHeld(null);
          settle(next, false, router.push);
        });
      },
    };
  });
  useEffect(() => {
    if (!dirty) return;
    return register(guard);
  }, [dirty]);

  const answer = (leave: boolean) => {
    if (!held) return;
    setHeld(null);
    settle(held, leave, router.push);
  };
  const leave = (go: () => void) => {
    const asking = asker();
    if (asking) asking.ask({ kind: "call", go });
    else go();
  };
  return { dialog: held && dialogs ? <dialogs.LeaveDialog onStay={() => answer(false)} onLeave={() => answer(true)} /> : null, leave };
}

/** The bar that offers changes kept in this browser (`useBrowserDraft`), drawn once its code is loaded. */
export function DraftOffer({ at, onRestore, onDiscard }: { at: number; onRestore: () => void; onDiscard: () => void }) {
  const dialogs = useDialogs(true);
  return dialogs ? <dialogs.RestoreBar at={at} onRestore={onRestore} onDiscard={onDiscard} /> : null;
}
