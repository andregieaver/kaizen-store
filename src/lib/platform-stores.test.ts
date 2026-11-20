import { describe, expect, it } from "vitest";

import { storeListFilter, storeListFiltered, storeListQuery } from "./platform-stores";

const PLAN = "0b6f8f9e-3c1d-4a5b-9e7f-1a2b3c4d5e6f";

/** The platform's Stores list reads its address one way (code review 2.10, D847). */
describe("storeListFilter", () => {
  it("is the whole list for an empty address", () => {
    expect(storeListFilter({})).toEqual({ q: "", state: null, plan: null, billing: null, page: 1 });
  });

  it("trims the search and cuts it at 100 characters", () => {
    expect(storeListFilter({ q: "  Kari  " }).q).toBe("Kari");
    expect(storeListFilter({ q: "x".repeat(150) }).q).toHaveLength(100);
    expect(storeListFilter({ q: ["first", "second"] }).q).toBe("first");
  });

  it("takes the last state named, as a chip pressed after the state the form keeps; all is every state", () => {
    expect(storeListFilter({ state: "suspended" }).state).toBe("suspended");
    expect(storeListFilter({ state: ["suspended", "closed"] }).state).toBe("closed");
    expect(storeListFilter({ state: ["closed", "all"] }).state).toBeNull();
    // A word the list does not know leaves the state as it was.
    expect(storeListFilter({ state: ["active", "deleted"] }).state).toBe("active");
    expect(storeListFilter({ state: "open" }).state).toBeNull();
  });

  it("reads a plan's id, in any case, or none; anything else is every plan", () => {
    expect(storeListFilter({ plan: PLAN.toUpperCase() }).plan).toBe(PLAN);
    expect(storeListFilter({ plan: "none" }).plan).toBe("none");
    expect(storeListFilter({ plan: "standard" }).plan).toBeNull();
    expect(storeListFilter({ plan: `${PLAN}'; drop table x` }).plan).toBeNull();
  });

  it("reads the subscription filters it knows and the page", () => {
    expect(storeListFilter({ billing: "overdue", page: "3" })).toMatchObject({ billing: "overdue", page: 3 });
    expect(storeListFilter({ billing: "past_due", page: "-1" })).toMatchObject({ billing: null, page: 1 });
  });
});

describe("the list's address", () => {
  it("keeps every filter in the pager's links and leaves out the empty ones", () => {
    const filter = { q: "kari", state: "closed" as const, plan: "none", billing: null };
    expect(storeListQuery(filter)).toEqual({ q: "kari", state: "closed", plan: "none", billing: undefined });
    expect(storeListQuery({ q: "", state: null, plan: null, billing: null })).toEqual({ q: undefined, state: undefined, plan: undefined, billing: undefined });
    // What the address said comes back as it was read: the list's own links lead to the same list.
    const read = storeListFilter({ q: "kari", state: "closed", plan: PLAN, billing: "cancelling", page: "2" });
    const { page, ...again } = storeListFilter(storeListQuery(read));
    expect(page).toBe(1);
    expect(again).toEqual({ q: "kari", state: "closed", plan: PLAN, billing: "cancelling" });
  });

  it("says whether anything narrows the list", () => {
    expect(storeListFiltered({ q: "", state: null, plan: null, billing: null })).toBe(false);
    expect(storeListFiltered({ q: "", state: null, plan: null, billing: "trialing" })).toBe(true);
    expect(storeListFiltered({ q: "a", state: null, plan: null, billing: null })).toBe(true);
  });
});
