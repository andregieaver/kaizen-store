"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { asker, register, settle, type Guard, type Held } from "./leave-listeners";

/**
 * One leave guard for every editor (code review 1.16, D787; the admin usability audit's H1 row). While an editor holds changes not
 * saved, leaving asks first, however it is left: closing or reloading the tab, a link anywhere in the admin, Back or Forward (how each
 * is heard is in `leave-listeners.ts`). It asks in the admin's own dialog (`leave-dialogs.tsx`, loaded once the editor has changes,
 * never with its first scripts): *Keep editing* or *Leave without saving*, which goes on the way the person set out. An editor's own
 * moves (a `router.push` after a choice) ask through `leave()`. Nothing is asked after a save or when nothing changed: an editor
 * registers only while it is dirty. Two editors on one screen (a dual page) share the listeners and one question.
 */

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
