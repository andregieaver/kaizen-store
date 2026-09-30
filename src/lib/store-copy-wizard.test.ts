import { describe, expect, it } from "vitest";

import { COPY_IDS_MAX } from "./store-copy";
import { choicesOf, idOf } from "./store-copy-test-support";
import { copiedStoreAdminPath, copiedStoreSetupPath, copyProgressPath, copyWizardPath } from "./store-copy-paths";
import {
  addIds,
  buildInput,
  clearIds,
  effectiveSlug,
  filterRows,
  initialWizard,
  needsDataConfirmation,
  selectedLine,
  setMode,
  summarySentence,
  toggleId,
  wizardProblems,
} from "./store-copy-wizard";

const choices = choicesOf();

describe("the copy wizard's choices", () => {
  it("opens with pages, products and posts, and no people or orders", () => {
    const state = initialWizard("Kaffe & Co");
    expect(state.name).toBe("Copy of Kaffe & Co");
    expect(state.options).toMatchObject({
      pages: { mode: "all" },
      products: { mode: "all" },
      posts: { mode: "all" },
      customers: false,
      orders: false,
    });
    expect(wizardProblems(state)).toEqual([]);
  });

  it("keeps ticked ids when the choice moves away and back", () => {
    let state = setMode(initialWizard("X"), "products", "selected");
    state = toggleId(state, "products", idOf(100), true);
    state = toggleId(state, "products", idOf(101), true);
    expect(state.options.products).toEqual({ mode: "selected", ids: [idOf(100), idOf(101)] });
    state = setMode(state, "products", "none");
    expect(state.options.products).toEqual({ mode: "none" });
    state = setMode(state, "products", "selected");
    expect(state.options.products).toEqual({ mode: "selected", ids: [idOf(100), idOf(101)] });
    state = toggleId(state, "products", idOf(100), false);
    expect(state.options.products).toEqual({ mode: "selected", ids: [idOf(101)] });
  });

  it("ticks only what is added, never twice, and clears a list", () => {
    let state = setMode(initialWizard("X"), "pages", "selected");
    state = addIds(state, "pages", [idOf(1), idOf(2)]);
    state = addIds(state, "pages", [idOf(2), idOf(3)]);
    expect(state.picked.pages).toEqual([idOf(1), idOf(2), idOf(3)]);
    expect(clearIds(state, "pages").options.pages).toEqual({ mode: "selected", ids: [] });
    // Ticking in a list that is not the chosen one only remembers.
    const all = toggleId(initialWizard("X"), "posts", idOf(200), true);
    expect(all.options.posts).toEqual({ mode: "all" });
    expect(all.picked.posts).toEqual([idOf(200)]);
  });

  it("filters rows by every word, ignoring case and accents", () => {
    const rows = [{ t: "Café stories /stories" }, { t: "About us /about" }, { t: "Delivery /delivery" }];
    const text = (row: { t: string }) => row.t;
    expect(filterRows(rows, "", text)).toHaveLength(3);
    expect(filterRows(rows, "CAFE", text)).toEqual([rows[0]]);
    expect(filterRows(rows, "  us about ", text)).toEqual([rows[1]]);
    expect(filterRows(rows, "nothing", text)).toEqual([]);
  });

  it("counts the selection for the live line", () => {
    expect(selectedLine(12, 40)).toBe("12 of 40 selected");
    expect(selectedLine(1200, 5000)).toBe("1,200 of 5,000 selected");
  });
});

describe("what needs another look", () => {
  const base = () => initialWizard("Kaffe & Co");

  it("asks for a name and an address that can be used", () => {
    expect(wizardProblems({ ...base(), name: "  " }).map((p) => p.field)).toEqual(["name"]);
    expect(wizardProblems({ ...base(), name: "x".repeat(81) }).map((p) => p.field)).toEqual(["name"]);
    expect(wizardProblems({ ...base(), slug: "-bad" })[0]).toMatchObject({ field: "slug" });
    expect(wizardProblems({ ...base(), slug: "no" })[0]).toMatchObject({ field: "slug" });
    expect(wizardProblems({ ...base(), slug: "good-one" })).toEqual([]);
    // A name that gives no address needs one typed.
    expect(wizardProblems({ ...base(), name: "!!" })[0]).toMatchObject({ field: "slug" });
    expect(wizardProblems({ ...base(), name: "!!", slug: "fine" })).toEqual([]);
  });

  it("does not accept Selected with nothing ticked, or too many", () => {
    const empty = setMode(base(), "products", "selected");
    expect(wizardProblems(empty)).toEqual([
      { field: "products", message: "Tick at least one product, or choose All or None." },
    ]);
    const ids = Array.from({ length: COPY_IDS_MAX + 1 }, (_, i) => idOf(i));
    const many = addIds(setMode(base(), "pages", "selected"), "pages", ids);
    expect(wizardProblems(many)[0]).toMatchObject({ field: "pages" });
    expect(wizardProblems(addIds(setMode(base(), "pages", "selected"), "pages", [idOf(1)]))).toEqual([]);
  });

  it("needs the confirmation with customers or orders", () => {
    const withCustomers = { ...base(), options: { ...base().options, customers: true } };
    expect(needsDataConfirmation(withCustomers.options)).toBe(true);
    expect(wizardProblems(withCustomers)).toEqual([
      { field: "confirmDataUse", message: "Confirm that you may use this customer data in the new store." },
    ]);
    const orders = { ...base(), options: { ...base().options, orders: true, confirmDataUse: true } };
    expect(wizardProblems(orders)).toEqual([]);
    expect(needsDataConfirmation(base().options)).toBe(false);
  });
});

describe("the summary and the input", () => {
  it("sums it up in one sentence", () => {
    const base = initialWizard("X");
    expect(summarySentence(base, choices)).toBe(
      "Copies the store's settings, plus all 3 pages, all 40 products and 1 post.",
    );
    let state = setMode(base, "products", "selected");
    state = addIds(state, "products", [idOf(100), idOf(101)]);
    state = setMode(state, "pages", "none");
    state = { ...state, options: { ...state.options, customers: true, orders: true } };
    expect(summarySentence(state, choices)).toBe(
      "Copies the store's settings, plus 2 of 40 products, 1 post, 210 customers and 128 orders as read-only history.",
    );
    const nothing = ["pages", "products", "posts"].reduce((s, k) => setMode(s, k as "pages", "none"), base);
    expect(summarySentence(nothing, choices)).toBe("Copies the store's settings only.");
    expect(summarySentence(base, choicesOf({ pages: [], products: [], posts: [] }))).toBe(
      "Copies the store's settings only.",
    );
  });

  it("builds the input the server takes", () => {
    let state = { ...initialWizard("Kaffe & Co"), name: "  Nord Kaffe ", slug: " Nord-Kaffe " };
    state = setMode(state, "products", "selected");
    state = addIds(state, "products", [idOf(100)]);
    const input = buildInput("kaffe", state);
    expect(input).toMatchObject({ source: "kaffe", name: "Nord Kaffe", slug: "nord-kaffe" });
    expect(input.options.products).toEqual({ mode: "selected", ids: [idOf(100)] });
  });

  it("never sends a confirmation nobody needs", () => {
    const state = initialWizard("X");
    expect(
      buildInput("kaffe", { ...state, options: { ...state.options, confirmDataUse: true } }).options.confirmDataUse,
    ).toBe(false);
    expect(
      buildInput("kaffe", { ...state, options: { ...state.options, customers: true, confirmDataUse: true } }).options
        .confirmDataUse,
    ).toBe(true);
  });

  it("makes the address from the name when none is typed", () => {
    expect(effectiveSlug({ name: "Kari's Kopper", slug: "" })).toBe("karis-kopper");
    expect(effectiveSlug({ name: "Kari's Kopper", slug: " Own " })).toBe("own");
  });
});

describe("where the pages are", () => {
  it("keeps to the owner's stores", () => {
    expect(copyWizardPath("kaffe")).toBe("/admin/stores/copy/kaffe");
    expect(copyProgressPath("abc-123")).toBe("/admin/stores/copies/abc-123");
    expect(copiedStoreAdminPath("nord")).toBe("/admin/nord");
    expect(copiedStoreSetupPath("nord")).toBe("/admin/nord/setup");
  });
});
