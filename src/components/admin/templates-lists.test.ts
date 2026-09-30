import { describe, expect, it } from "vitest";

import type { TemplateActions } from "@/lib/templates";

import { LOAD_PROBLEM, SWITCH_PROBLEM, createTemplateStore } from "./templates-lists";
import { fakeActions, item } from "./templates-test-support";

const MARKET = [item({ id: "a", name: "Hero", active: true }), item({ id: "b", name: "Promise", kind: "block" })];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the template lists", () => {
  it("are read once per source, when first asked for", async () => {
    const { actions, calls } = fakeActions({ marketplace: MARKET });
    const store = createTemplateStore(actions);
    expect(store.get().lists.marketplace.status).toBe("idle");
    store.load("marketplace");
    store.load("marketplace");
    expect(store.get().lists.marketplace.status).toBe("loading");
    await tick();
    store.load("marketplace");
    expect(calls.list).toEqual(["marketplace"]);
    expect(store.get().lists.marketplace).toMatchObject({ status: "ready", items: MARKET });
    expect(store.get().lists.stores.status).toBe("idle");
  });

  it("say so when they cannot be read, and are read again on request", async () => {
    let fail = true;
    const actions: TemplateActions = {
      ...fakeActions({ stores: MARKET }).actions,
      list: async () => {
        if (fail) throw new Error("offline");
        return MARKET;
      },
    };
    const store = createTemplateStore(actions);
    store.load("stores");
    await tick();
    expect(store.get().lists.stores).toMatchObject({ status: "error", problem: LOAD_PROBLEM });
    store.load("stores");
    expect(store.get().lists.stores.status).toBe("error");
    fail = false;
    store.load("stores", true);
    await tick();
    expect(store.get().lists.stores.status).toBe("ready");
  });

  it("switch a template on at once, and keep it when the server agrees", async () => {
    const { actions, calls } = fakeActions({ marketplace: MARKET });
    const store = createTemplateStore(actions);
    store.load("marketplace");
    await tick();
    const done = store.setActive("marketplace", "b", true);
    expect(store.get().lists.marketplace.items.find((i) => i.id === "b")?.active).toBe(true);
    expect(store.get().busy.has("b")).toBe(true);
    expect(await done).toEqual([]);
    expect(store.get().busy.has("b")).toBe(false);
    expect(store.get().lists.marketplace.items.find((i) => i.id === "b")?.active).toBe(true);
    expect(calls.setActive).toEqual([["b", true]]);
  });

  it("undo the switch and say why when the server refuses", async () => {
    const { actions } = fakeActions(
      { marketplace: MARKET },
      { setActive: { ok: false, problems: ["That template is no longer shared."] } },
    );
    const store = createTemplateStore(actions);
    store.load("marketplace");
    await tick();
    expect(await store.setActive("marketplace", "b", true)).toEqual(["That template is no longer shared."]);
    expect(store.get().lists.marketplace.items.find((i) => i.id === "b")?.active).toBe(false);
    expect(store.get().problems.b).toEqual(["That template is no longer shared."]);
    expect(store.get().busy.size).toBe(0);
    // A new try clears the old problem.
    const second = store.setActive("marketplace", "a", false);
    expect(store.get().problems.b).toEqual(["That template is no longer shared."]);
    await second;
    expect(store.get().lists.marketplace.items.find((i) => i.id === "a")?.active).toBe(true);
  });

  it("undo the switch when the call fails altogether", async () => {
    const base = fakeActions({ marketplace: MARKET }).actions;
    const store = createTemplateStore({
      ...base,
      setActive: async () => {
        throw new Error("offline");
      },
    });
    store.load("marketplace");
    await tick();
    expect(await store.setActive("marketplace", "a", false)).toEqual([SWITCH_PROBLEM]);
    expect(store.get().lists.marketplace.items.find((i) => i.id === "a")?.active).toBe(true);
  });

  it("tell the listeners of every change", async () => {
    const { actions } = fakeActions({ stores: MARKET });
    const store = createTemplateStore(actions);
    let heard = 0;
    const stop = store.subscribe(() => heard++);
    store.load("stores");
    await tick();
    expect(heard).toBe(2);
    stop();
    await store.setActive("stores", "b", true);
    expect(heard).toBe(2);
  });

  it("do nothing without actions (Kaizen's own pages)", async () => {
    const store = createTemplateStore(null);
    store.load("marketplace");
    expect(store.get().lists.marketplace.status).toBe("idle");
    expect(await store.setActive("marketplace", "a", true)).toEqual([SWITCH_PROBLEM]);
  });
});
