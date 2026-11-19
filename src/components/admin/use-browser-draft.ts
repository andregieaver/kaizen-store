"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { browserStorage, pruneDrafts, readDraft, removeDraft, writeDraft, type StoredDraft } from "@/lib/browser-draft";

import { whenLeaving } from "./leave-listeners";

/** A draft is written this long after the last change, and at least this often while changes keep coming. */
const QUIET_MS = 800;
const LONGEST_MS = 5000;
/** Old drafts are swept once a page load. */
let swept = false;

/**
 * Keeps an editor's unsaved work in this browser (code review 1.16, D787, `src/lib/browser-draft.ts`) under `key` (per store and per
 * page or product; null keeps nothing), made from the saved version `base` names. While `dirty`, `value` is written a moment after each
 * change and when the tab is hidden; a save (dirty again false) and leaving on purpose (*Leave without saving*) remove it. When the
 * editor opens on a draft of the version it shows, holding something else than it opened with (`opened`), it is the `offer`:
 * `restore()` hands it back, `discard()` drops it. An offer whose version a save has since replaced is no longer offered.
 */
export function useBrowserDraft<T>({
  key,
  base,
  value,
  dirty,
  opened,
}: {
  key: string | null;
  base: () => string;
  value: T;
  dirty: boolean;
  opened: () => T;
}): { offer: StoredDraft<T> | null; restore: () => T | null; discard: () => void } {
  const [found, setFound] = useState<StoredDraft<T> | null>(null);
  const latest = useRef({ key, base, value, dirty, opened });
  useEffect(() => {
    latest.current = { key, base, value, dirty, opened };
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the first change not yet written was made, and the key last written (what a save or a leave removes).
  const since = useRef(0);
  const kept = useRef<string | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    since.current = 0;
  }, []);
  const writeNow = useCallback(() => {
    cancel();
    const now = latest.current;
    if (now.key && now.dirty && writeDraft(browserStorage(), now.key, now.base(), now.value, Date.now())) kept.current = now.key;
  }, [cancel]);
  const drop = useCallback(() => {
    cancel();
    if (kept.current) removeDraft(browserStorage(), kept.current);
    kept.current = null;
  }, [cancel]);

  // Read once the page is in the browser (the server never sees storage), so the first paint matches the server's.
  useEffect(() => {
    if (!swept) {
      swept = true;
      pruneDrafts(browserStorage(), Date.now());
    }
    if (!key) return;
    const draft = readDraft<T>(browserStorage(), key, latest.current.base(), latest.current.opened, Date.now());
    setFound(draft);
  }, [key]);

  useEffect(() => {
    if (!key || !dirty) {
      if (!dirty) drop();
      else cancel();
      return;
    }
    const now = Date.now();
    if (since.current === 0) since.current = now;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(writeNow, Math.max(0, Math.min(QUIET_MS, since.current + LONGEST_MS - now)));
  }, [key, dirty, value, cancel, drop, writeNow]);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden" && timer.current !== null) writeNow();
    };
    const gone = () => {
      if (timer.current !== null) writeNow();
    };
    window.addEventListener("pagehide", gone);
    document.addEventListener("visibilitychange", hidden);
    const stop = whenLeaving(drop);
    return () => {
      stop();
      window.removeEventListener("pagehide", gone);
      document.removeEventListener("visibilitychange", hidden);
      // Any other way out (a link that was not asked about, the session ending) keeps what was not yet written.
      gone();
    };
  }, [drop, writeNow]);

  const offer = found && found.base === base() ? found : null;
  return {
    offer,
    restore: () => {
      setFound(null);
      return offer ? offer.value : null;
    },
    // The changes made since the editor opened, if any, take the old draft's place; else it is removed.
    discard: () => {
      setFound(null);
      if (latest.current.dirty) writeNow();
      else if (key) removeDraft(browserStorage(), key);
    },
  };
}
