/**
 * Undo and redo for the page builder (D305): what the editor held before each change, and what it held before each undo. Pure, so it
 * can be tested without a browser. Changes that come close together of the same kind (letters typed in a field, a slider dragged) make
 * one step, so Undo takes back a word or a drag, not a letter; anything else is a step of its own.
 */

/** How many steps are kept back and forward. */
export const HISTORY_MAX = 100;

/** Changes of one kind within this many milliseconds of the one before them make one step. */
export const GROUP_MS = 800;

export type History<T> = {
  /** What the editor held before each step, the oldest first. */
  past: T[];
  /** What it held before each undo, the most recently undone last. */
  future: T[];
  /** The kind and time of the last change recorded, to group the next with it. */
  last: { kind: string; at: number } | null;
};

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], last: null });

/**
 * Records that the editor is about to move from `before` to something new. A change of the same `kind` as the one before it, within
 * `GROUP_MS`, joins that step (its `before` is already kept). Every new change ends what could be redone.
 */
export function record<T>(history: History<T>, before: T, kind: string, at: number): History<T> {
  const joins = history.last !== null && history.last.kind === kind && at - history.last.at <= GROUP_MS && history.past.length > 0;
  const past = joins ? history.past : [...history.past, before].slice(-HISTORY_MAX);
  return { past, future: [], last: { kind, at } };
}

/** Takes back the last step: what to show, and the history after it; nothing when there is nothing to undo. */
export function undo<T>(history: History<T>, present: T): { value: T; history: History<T> } | null {
  if (history.past.length === 0) return null;
  const value = history.past[history.past.length - 1];
  return {
    value,
    history: { past: history.past.slice(0, -1), future: [...history.future, present].slice(-HISTORY_MAX), last: null },
  };
}

/** Puts back the step last undone; nothing when there is nothing to redo. */
export function redo<T>(history: History<T>, present: T): { value: T; history: History<T> } | null {
  if (history.future.length === 0) return null;
  const value = history.future[history.future.length - 1];
  return {
    value,
    history: { past: [...history.past, present].slice(-HISTORY_MAX), future: history.future.slice(0, -1), last: null },
  };
}

/** Whether a key press is Undo (Ctrl/Cmd+Z) or Redo (Ctrl/Cmd+Shift+Z, Ctrl+Y), else null. */
export function historyKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}
