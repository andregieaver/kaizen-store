import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The builder imports its owners' actions only as types, but its neighbours read the database; nothing here calls them.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { PageBuilder } from "./page-builder";
import { RAIL_KEYS, Rail, isFolded, railColumns } from "./builder-rails";
import { TemplatesModal } from "./templates-modal";
import { SHARING_NOTE, SharingBadge, SharingChoice, SharingSelect } from "./templates-sharing";
import { TemplatesTab } from "./templates-tab";
import { initialState, type TemplateController, type TemplateState } from "./templates-lists";
import type { TemplateUse } from "./templates-use";
import { fakeActions, item, saved } from "./templates-test-support";

/** Drawn on the server as the other admin components' tests do: what a person sees before any script runs. */
const text = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'");

const LIST = [
  item({
    id: "a",
    kind: "block",
    name: "Delivery promise",
    summary: "Text",
    publisher: "Kaizen",
    fromKaizen: true,
    active: true,
  }),
  item({ id: "b", kind: "row", name: "Hero with picture", summary: "2 columns: image, heading" }),
  item({
    id: "c",
    kind: "column",
    name: "Contact details",
    summary: "Heading, text",
    publisher: "Café Nord",
    active: true,
  }),
  item({ id: "d", kind: "row", name: "Three reasons", summary: "3 columns: icon list", active: true }),
];

const controller = (
  marketplace: Partial<TemplateState["lists"]["marketplace"]> = {},
  extra: Partial<TemplateState> = {},
): TemplateController => {
  const state = initialState();
  return {
    ...state,
    lists: { ...state.lists, marketplace: { status: "ready", items: LIST, problem: null, ...marketplace } },
    ...extra,
    load: () => {},
    setActive: async () => [],
  };
};

const idle: TemplateUse = { using: null, issues: {}, added: null, run: () => {} };

const tab = (over: Partial<ComponentProps<typeof TemplatesTab>> = {}) =>
  text(
    createElement(TemplatesTab, {
      controller: controller(),
      use: idle,
      source: "marketplace",
      onSource: () => {},
      shown: true,
      onBrowse: () => {},
      onPreview: () => {},
      pageType: "page",
      rowsFull: false,
      blocksFull: false,
      ...over,
    }),
  );

describe("the Templates tab", () => {
  it("has the source toggle, and lists only what is activated, under Rows, Columns and Components", () => {
    const out = tab();
    expect(out).toContain('aria-label="Templates from"');
    expect(out).toContain("My stores");
    expect(out).toContain("Marketplace");
    expect(out).toMatch(/aria-pressed="true"[^>]*>Marketplace/);
    expect(out).toContain("Delivery promise");
    expect(out).toContain("Contact details");
    expect(out).toContain("Three reasons");
    expect(out).not.toContain("Hero with picture");
    expect(out.indexOf("Rows")).toBeLessThan(out.indexOf("Columns"));
    expect(out.indexOf("Columns")).toBeLessThan(out.indexOf("Components"));
    expect(out).toContain("By Café Nord");
    expect(out).toContain("3 columns: icon list");
    expect(out).toContain('aria-label="Use row Three reasons"');
    expect(out).toContain("Browse templates");
  });

  it("says what is missing when nothing from a source is on, with the button below", () => {
    const out = tab({ controller: controller({ items: LIST.map((i) => ({ ...i, active: false })) }) });
    expect(out).toContain("No templates activated from the marketplace");
    expect(out).toContain("Browse templates");
    expect(out.indexOf("No templates activated")).toBeLessThan(out.indexOf("Browse templates"));
    expect(out).not.toContain('aria-label="Use ');
  });

  it("shows loading and an error with a way to try again", () => {
    expect(tab({ controller: controller({ status: "loading", items: [] }) })).toContain("Loading templates");
    expect(tab({ controller: controller({ status: "idle", items: [] }) })).toContain("Loading templates");
    const failed = tab({
      controller: controller({ status: "error", items: [], problem: "The templates could not be loaded." }),
    });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("The templates could not be loaded.");
    expect(failed).toContain("Try again");
  });

  it("switches Use off for a kind the page has no room for", () => {
    const out = tab({ blocksFull: true });
    expect(out).toMatch(/disabled=""[^>]*aria-label="Use component Delivery promise"/);
    expect(out).not.toMatch(/disabled=""[^>]*aria-label="Use row Three reasons"/);
  });
});

const modal = (over: Partial<ComponentProps<typeof TemplatesModal>> = {}) =>
  text(
    createElement(TemplatesModal, {
      controller: controller(),
      use: idle,
      source: "marketplace",
      onSource: () => {},
      open: true,
      onClose: () => {},
      onPreview: () => {},
      pageType: "page",
      rowsFull: false,
      blocksFull: false,
      ...over,
    }),
  );

describe("the templates modal", () => {
  it("has a tab for each source and lists every template of the one open, grouped", () => {
    const out = modal();
    expect(out).toContain("<dialog");
    expect(out).toContain('role="tablist"');
    expect(out).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Marketplace/);
    expect(out).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>My stores/);
    for (const name of ["Delivery promise", "Hero with picture", "Contact details", "Three reasons"])
      expect(out).toContain(name);
    expect(out.indexOf("Rows")).toBeLessThan(out.indexOf("Components"));
    expect(out).toContain("By Kaizen");
    expect(out).toContain("By Café Nord");
  });

  it("marks Kaizen's templates and says which are on", () => {
    const out = modal();
    expect(out.match(/>Kaizen</g)).toHaveLength(1);
    expect(out).toContain("Activated");
    expect(out).toContain('aria-label="Deactivate Delivery promise"');
    expect(out).toContain('aria-label="Activate Hero with picture"');
  });

  it("has kind chips, an Activated only switch and a search box, each named", () => {
    const out = modal();
    for (const chip of ["All", "Page layouts", "Rows", "Columns", "Components"]) expect(out).toContain(`>${chip}</button>`);
    expect(out).toMatch(/aria-pressed="true"[^>]*>All/);
    expect(out).toContain('role="switch"');
    expect(out).toContain("Activated only");
    expect(out).toContain("Search templates");
    expect(out).toContain('type="search"');
  });

  it("says what is wrong with a template that would not switch", () => {
    const out = modal({ controller: controller({}, { problems: { b: ["That template is no longer shared."] } }) });
    expect(out).toContain('role="alert"');
    expect(out).toContain("That template is no longer shared.");
  });

  it("says when a source has nothing, is loading, or failed", () => {
    expect(modal({ controller: controller({ items: [] }) })).toContain("Nothing in the marketplace yet");
    expect(modal({ source: "stores", controller: controller() })).toContain("Loading templates");
    const failed = modal({
      controller: controller({ status: "error", items: [], problem: "The templates could not be loaded." }),
    });
    expect(failed).toContain("The templates could not be loaded.");
    expect(failed).toContain("Try again");
  });

  it("draws nothing while closed", () => {
    expect(modal({ open: false })).not.toContain("Activated only");
  });
});

describe("the sharing choice", () => {
  it("offers only this store, my stores and the marketplace, with their hints, and starts on the first", () => {
    const out = text(createElement(SharingChoice, { value: "private", onChange: () => {} }));
    expect(out).toContain("Share");
    expect(out).toContain("Only this store");
    expect(out).toContain("Nobody else can see it.");
    expect(out).toContain("My stores");
    expect(out).toContain("The other stores you own can use it.");
    expect(out).toContain("Marketplace");
    expect(out).toContain("Every store owner can find and use it");
    expect(out.match(/type="radio"/g)).toHaveLength(3);
    expect(out.match(/checked=""/g)).toHaveLength(1);
    expect(out).toMatch(/value="private"[^>]*checked=""|checked=""[^>]*value="private"/);
  });

  it("says honestly what a shared copy leaves behind", () => {
    const out = text(createElement(SharingChoice, { value: "marketplace", onChange: () => {} }));
    expect(out).toContain(SHARING_NOTE);
    expect(SHARING_NOTE).toMatch(/text and pictures/);
    expect(SHARING_NOTE).toMatch(/links to this store's pages, products, menus or forms/);
  });

  it("marks a shared part, and a private one not at all", () => {
    expect(text(createElement(SharingBadge, { sharing: "marketplace" }))).toContain("Marketplace");
    expect(text(createElement(SharingBadge, { sharing: "stores" }))).toContain("My stores");
    expect(text(createElement(SharingBadge, { sharing: "private" }))).toBe("");
  });

  it("lets a saved part's sharing be changed from a select", () => {
    const out = text(
      createElement(SharingSelect, {
        part: saved("p", "stores"),
        setSharing: fakeActions().actions.setSharing,
        onChanged: () => {},
      }),
    );
    expect(out).toContain('aria-label="Sharing of Hero with picture"');
    expect(out).toContain("Shared with");
    expect(out).toMatch(/<option value="stores" selected="">My stores/);
    expect(out.match(/<option/g)).toHaveLength(3);
  });
});

describe("the sidebars' rails", () => {
  it("say when they are folded and what they open", () => {
    const out = text(createElement(Rail, { side: "left", label: "building blocks", controls: "x", onOpen: () => {} }));
    expect(out).toContain('aria-label="Show building blocks"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-controls="x"');
  });

  it("give the canvas the room a folded sidebar frees", () => {
    expect(railColumns(false, false)).toBe("lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]");
    expect(railColumns(true, false)).toBe("lg:grid-cols-[2.75rem_minmax(0,2fr)_minmax(0,1fr)]");
    expect(railColumns(false, true)).toBe("lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2.75rem]");
    expect(railColumns(true, true)).toBe("lg:grid-cols-[2.75rem_minmax(0,1fr)_2.75rem]");
  });

  it("are kept apart per side, and only a stored 'folded' folds", () => {
    expect(RAIL_KEYS.left).not.toBe(RAIL_KEYS.right);
    expect(isFolded("folded")).toBe(true);
    expect(isFolded(null)).toBe(false);
    expect(isFolded("true")).toBe(false);
  });
});

/** The whole builder on the server, with or without templates. */
const builder = (
  templates: ComponentProps<typeof PageBuilder>["templates"],
  saved_: ComponentProps<typeof PageBuilder>["saved"] = [],
) =>
  text(
    createElement(PageBuilder, {
      pageType: "page",
      rows: [],
      onRows: () => {},
      saved: saved_,
      onSaved: () => {},
      upload: null,
      aside: createElement("p", null, "Page title"),
      grid: {
        pageId: null,
        owner: templates ? "store-1" : null,
        pageTerms: [],
        articleTerms: [],
        stores: [],
        menus: [],
        menusHref: "/menus",
        actions: {} as never,
      },
      fonts: {
        site: { heading: null, body: null } as never,
        style: undefined,
        install: async () => ({ ok: true as const }),
        theme: null,
      },
      templates,
    }),
  );

describe("the builder's sidebars", () => {
  it("has a Templates tab in a store's builder, in place of Layers", () => {
    const out = builder(fakeActions().actions);
    expect(out).toMatch(/role="tab"[^>]*>Templates</);
    expect(out).toContain("Browse templates");
    expect(out).not.toContain("Layers");
    expect(out).not.toContain("Coming soon");
    expect(out).toContain("grid-cols-4");
  });

  it("has no Templates tab on Kaizen's own pages, nor Layers or Coming soon", () => {
    const out = builder(null);
    expect(out).not.toContain("Templates");
    expect(out).not.toContain("Browse templates");
    expect(out).not.toContain("Layers");
    expect(out).not.toContain("Coming soon");
    expect(out).toMatch(/role="tab"[^>]*>Components</);
    expect(out).toMatch(/role="tab"[^>]*>Saved</);
    expect(out).toContain("grid-cols-3");
  });

  it("starts with both sidebars open, each with a named button to fold it", () => {
    const out = builder(fakeActions().actions);
    expect(out).toContain('aria-label="Hide building blocks"');
    expect(out).toContain('aria-label="Hide settings"');
    expect(out).toContain('title="Hide building blocks"');
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(out).not.toContain('aria-label="Show ');
    expect(out).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]");
    expect(out).toContain("Page title");
  });

  it("shows who can use each saved part in a store's builder, and nothing about it on Kaizen's", () => {
    const parts = [saved("p1", "marketplace", "Hero"), saved("p2", "private", "Contact")];
    const store = builder(fakeActions().actions, parts);
    expect(store).toContain('aria-label="Sharing of Hero"');
    expect(store).toContain('aria-label="Sharing of Contact"');
    // The badge is only on the shared one.
    expect(store.match(/rounded-full border border-border px-1\.5/g)).toHaveLength(1);
    const kaizen = builder(null, parts);
    expect(kaizen).not.toContain("Sharing of");
    expect(kaizen).not.toContain("Shared with");
  });

  it("no longer has Kaizen's library under Saved", () => {
    expect(builder(fakeActions().actions)).not.toContain("Kaizen's library");
    expect(builder(null)).not.toContain("library");
  });
});
