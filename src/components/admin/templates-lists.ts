"use client";

import { useMemo, useSyncExternalStore } from "react";

import type { TemplateActions, TemplateItem, TemplateSource } from "@/lib/templates";

import { patchTemplate } from "./templates-helpers";

/**
 * The lists of templates the builder's Templates tab and its modal share (D125): each source is read once, when the tab
 * or the modal first needs it, and kept; switching a template on or off changes it at once and is undone if the server
 * says no. The state is a small store of its own, apart from React, so it is tested without drawing anything.
 */

export type ListState = {
  status: "idle" | "loading" | "ready" | "error";
  items: TemplateItem[];
  problem: string | null;
};

export type TemplateState = {
  lists: Record<TemplateSource, ListState>;
  /** Templates being switched. */
  busy: ReadonlySet<string>;
  /** What went wrong with the last try to switch a template, by id. */
  problems: Readonly<Record<string, string[]>>;
};

const IDLE: ListState = { status: "idle", items: [], problem: null };
export const initialState = (): TemplateState => ({
  lists: { stores: IDLE, marketplace: IDLE },
  busy: new Set(),
  problems: {},
});

export const LOAD_PROBLEM = "The templates could not be loaded.";
export const SWITCH_PROBLEM = "It could not be changed. Try again.";

export type TemplateStore = {
  get: () => TemplateState;
  subscribe: (listener: () => void) => () => void;
  /** Reads a source unless it is being read or already was; `again` reads it anew after an error. */
  load: (source: TemplateSource, again?: boolean) => void;
  /** Switches a template on or off; resolves to what went wrong, empty when it worked. */
  setActive: (source: TemplateSource, id: string, active: boolean) => Promise<string[]>;
};

export function createTemplateStore(actions: TemplateActions | null): TemplateStore {
  let state = initialState();
  const listeners = new Set<() => void>();
  const set = (next: TemplateState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const list = (source: TemplateSource, update: (list: ListState) => ListState) =>
    set({ ...state, lists: { ...state.lists, [source]: update(state.lists[source]) } });

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    load: (source, again = false) => {
      if (!actions) return;
      const { status } = state.lists[source];
      if (status === "loading" || (status !== "idle" && !(again && status === "error"))) return;
      list(source, (current) => ({ ...current, status: "loading", problem: null }));
      actions.list(source).then(
        (items) => list(source, () => ({ status: "ready", items, problem: null })),
        () => list(source, (current) => ({ ...current, status: "error", problem: LOAD_PROBLEM })),
      );
    },

    setActive: async (source, id, active) => {
      if (!actions) return [SWITCH_PROBLEM];
      set({ ...state, busy: new Set(state.busy).add(id), problems: { ...state.problems, [id]: [] } });
      list(source, (current) => ({ ...current, items: patchTemplate(current.items, id, { active }) }));
      let failed: string[] = [];
      try {
        const result = await actions.setActive(id, active);
        if (!result.ok) failed = result.problems.length > 0 ? result.problems : [SWITCH_PROBLEM];
      } catch {
        failed = [SWITCH_PROBLEM];
      }
      if (failed.length > 0) {
        // Back to what it was, unless it has been changed again since.
        list(source, (current) => ({
          ...current,
          items: current.items.map((item) =>
            item.id === id && item.active === active ? { ...item, active: !active } : item,
          ),
        }));
      }
      const busy = new Set(state.busy);
      busy.delete(id);
      set({ ...state, busy, problems: failed.length > 0 ? { ...state.problems, [id]: failed } : state.problems });
      return failed;
    },
  };
}

export type TemplateController = TemplateState & Pick<TemplateStore, "load" | "setActive">;

export function useTemplateLists(actions: TemplateActions | null): TemplateController {
  const store = useMemo(() => createTemplateStore(actions), [actions]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { ...state, load: store.load, setActive: store.setActive };
}
