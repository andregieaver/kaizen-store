import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Nothing here calls the server; the builder's neighbours only read the database when imported.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { ROWS_MAX, type PageRow } from "@/lib/page-content";
import type { PageLayout } from "@/lib/page-layout";
import type { PendingLayout } from "./templates-apply";
import { PageBuilder } from "./page-builder";
import { SavedLayoutDialog } from "./saved-layout-dialog";
import { SAVED_AS_TEMPLATE, SaveTemplateDialog, defaultTemplateName } from "./save-template-dialog";
import { ApplyLayoutDialog } from "./templates-apply";
import { initialState, type TemplateController } from "./templates-lists";
import { TemplatesModal } from "./templates-modal";
import { TemplatePreviewDialog } from "./templates-preview";
import { TemplatesTab } from "./templates-tab";
import { USE_PROBLEM, fetchTemplate, type TemplateUse } from "./templates-use";
import { fakeActions, item, layoutItem, row, saved } from "./templates-test-support";

const text = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'");

const LAYOUTS = [
  layoutItem({ id: "l1", name: "Landing page", pageType: "page", active: true }),
  layoutItem({ id: "l2", name: "Story layout", pageType: "article", active: true, publisher: "Café Nord" }),
  layoutItem({ id: "l3", name: "Idle layout", pageType: "page", active: false }),
  item({ id: "r1", kind: "row", name: "Three reasons", active: true }),
];

const controller = (items = LAYOUTS): TemplateController => {
  const state = initialState();
  return {
    ...state,
    lists: { ...state.lists, marketplace: { status: "ready", items, problem: null } },
    load: () => {},
    setActive: async () => [],
  };
};
const idle: TemplateUse = { using: null, issues: {}, added: null, run: () => {} };

const preview = (over: Partial<ComponentProps<typeof TemplatePreviewDialog>> = {}) =>
  text(
    createElement(TemplatePreviewDialog, {
      item: LAYOUTS[0],
      href: "/admin/preview/templates/l1",
      returnFocus: null,
      reason: null,
      switching: false,
      using: false,
      usingAny: false,
      problems: [],
      onToggleActive: () => {},
      onUse: () => {},
      onClose: () => {},
      ...over,
    }),
  );

describe("the preview dialog", () => {
  it("is a native dialog, named, with the template's own page in a titled, sandboxed frame", () => {
    const out = preview();
    expect(out).toContain("<dialog");
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toContain("Preview: Landing page");
    expect(out).toContain('<iframe title="Preview of Landing page" src="/admin/preview/templates/l1"');
    expect(out).toContain('sandbox="allow-same-origin"');
  });

  it("says what the template is: its kind, who published it, what is in it and which pages it is for", () => {
    const out = preview({ item: LAYOUTS[1], href: "/p/l2" });
    expect(out).toContain("Page layout");
    expect(out).toContain("For articles");
    expect(out).toContain("By Café Nord");
    expect(out).toContain("3 rows: heading, text");
    const kaizen = preview({ item: layoutItem({ id: "k", publisher: "Kaizen", fromKaizen: true }) });
    expect(kaizen).toContain("By Kaizen");
  });

  it("starts loading, with a status a screen reader hears", () => {
    expect(preview()).toContain("Loading the preview");
    expect(preview()).toMatch(/role="status"[^>]*>Loading the preview/);
  });

  it("has a device switch of radio buttons: desktop on, one tab stop", () => {
    const out = preview();
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-label="Preview width"');
    expect(out.match(/role="radio"/g)).toHaveLength(3);
    expect(out).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*tabindex="0"[^>]*>Desktop/);
    expect(out).toMatch(/role="radio"[^>]*aria-checked="false"[^>]*tabindex="-1"[^>]*>Tablet/);
    expect(out).toMatch(/role="radio"[^>]*aria-checked="false"[^>]*tabindex="-1"[^>]*>Mobile/);
    expect(out).toContain("768 pixels wide");
    expect(out).toContain("390 pixels wide");
    // Desktop is all of the room.
    expect(out).toContain("width:100%");
  });

  it("switches on or off for this store, following the template's state", () => {
    expect(preview({ item: LAYOUTS[2] })).toContain("Activate for this store");
    const on = preview({ item: LAYOUTS[0] });
    expect(on).toContain("Deactivate for this store");
    expect(on).toContain('aria-pressed="true"');
    expect(preview({ switching: true })).toMatch(/disabled=""[^>]*aria-pressed/);
  });

  it("has Use and Close at the bottom", () => {
    const out = preview();
    expect(out).toContain(">Close</button>");
    expect(out).toContain('aria-label="Close preview"');
    expect(out).toMatch(/>Use<\/button>/);
    expect(out).not.toMatch(/disabled=""[^>]*>Use</);
  });

  it("switches Use off with the reason in words, joined to the button", () => {
    const out = preview({ item: LAYOUTS[1], reason: "Made for articles, so it cannot be used on pages." });
    expect(out).toContain("Made for articles, so it cannot be used on pages.");
    expect(out).toMatch(/disabled=""[^>]*aria-describedby="[^"]+"[^>]*title="Made for articles[^"]*"[^>]*>Use</);
  });

  it("shows what went wrong with the last try", () => {
    expect(preview({ problems: ["It could not be added. Try again."] })).toContain("It could not be added.");
  });

  it("draws nothing while no template is being previewed", () => {
    const out = preview({ item: null, href: null });
    expect(out).toContain("<dialog");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("Preview width");
  });
});

describe("the Templates tab with page layouts", () => {
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

  it("lists page layouts first, only the switched on ones made for this kind of page", () => {
    const out = tab();
    expect(out).toContain("Page layouts");
    expect(out.indexOf("Page layouts")).toBeLessThan(out.indexOf("Rows"));
    expect(out).toContain("Landing page");
    expect(out).not.toContain("Story layout");
    expect(out).not.toContain("Idle layout");
    expect(out).toContain('aria-label="Use page layout Landing page"');
    const article = tab({ pageType: "article" });
    expect(article).toContain("Story layout");
    expect(article).not.toContain("Landing page");
  });

  it("gives every card a Preview button, named for the template", () => {
    const out = tab();
    expect(out).toContain('aria-label="Preview Landing page"');
    expect(out).toContain('aria-label="Preview Three reasons"');
    expect(out.match(/>Preview<\/button>/g)).toHaveLength(2);
  });

  it("does not stop a page layout on a page that is full: it replaces the rows", () => {
    expect(tab({ rowsFull: true, blocksFull: true })).not.toMatch(/disabled=""[^>]*aria-label="Use page layout/);
    expect(tab({ rowsFull: true })).toMatch(/disabled=""[^>]*aria-label="Use row Three reasons"/);
  });

  it("says a template is being fetched, and what came of the last try", () => {
    expect(tab({ use: { ...idle, using: "l1" } })).toContain("Adding …");
    expect(tab({ use: { ...idle, issues: { l1: ["Nothing to add."] } } })).toContain("Nothing to add.");
    expect(tab({ use: { ...idle, added: "r1" } })).toContain("Added to the page.");
  });
});

describe("the Browse modal with page layouts", () => {
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

  it("has a Page layouts chip, and can open on it", () => {
    expect(modal()).toMatch(/aria-pressed="true"[^>]*>All/);
    const out = modal({ kind: "page" });
    expect(out).toMatch(/aria-pressed="true"[^>]*>Page layouts/);
    expect(out).toContain("Landing page");
    expect(out).not.toContain("Three reasons");
  });

  it("lists layouts for every kind of page, marks each, and switches Use off for another kind", () => {
    const out = modal();
    expect(out).toContain("For pages");
    expect(out).toContain("For articles");
    expect(out).toContain("Made for articles, so it cannot be used on pages.");
    expect(out).toMatch(/disabled=""[^>]*aria-label="Use page layout Story layout"[^>]*title="Made for articles/);
    expect(out).not.toMatch(/disabled=""[^>]*aria-label="Use page layout Landing page"/);
    expect(out).not.toMatch(/disabled=""[^>]*aria-label="Use page layout Idle layout"/);
  });

  it("has Preview, Use and Activate on every card", () => {
    const out = modal();
    expect(out).toContain('aria-label="Preview Idle layout"');
    expect(out).toContain('aria-label="Activate Idle layout"');
    expect(out).toContain('aria-label="Deactivate Landing page"');
    expect(out).toContain('aria-label="Use row Three reasons"');
  });
});

describe("saving a page's layout as a template", () => {
  const layout: PageLayout = { pageType: "page", rows: [row("r")], css: "" };
  const dialog = (over: Partial<ComponentProps<typeof SaveTemplateDialog>> = {}) =>
    text(
      createElement(SaveTemplateDialog, {
        open: true,
        create: async () => ({ ok: true as const, parts: [], id: "x" }),
        layout,
        defaultName: "Summer sale",
        canShare: true,
        onClose: () => {},
        onSaved: () => {},
        ...over,
      }),
    );

  it("starts with the page's title as the name, and says what is saved", () => {
    const out = dialog();
    expect(out).toContain("Save as template");
    expect(out).toContain('value="Summer sale"');
    expect(out).toMatch(/for="[^"]+-name"/);
    expect(out).toContain("its 1 row");
    expect(out).toContain("Save template");
  });

  it("offers who can use it in a store, and nothing about it in Kaizen's own builder", () => {
    const store = dialog();
    expect(store).toContain("Only this store");
    expect(store).toContain("Marketplace");
    expect(store.match(/type="radio"/g)).toHaveLength(3);
    const kaizen = dialog({ canShare: false });
    expect(kaizen).not.toContain("Marketplace");
    expect(kaizen).not.toContain('type="radio"');
  });

  it("mentions the page's CSS when it comes along", () => {
    expect(dialog({ layout: { ...layout, css: "a{}" } })).toContain("and its custom CSS");
  });

  it("draws nothing while closed", () => {
    expect(dialog({ open: false })).not.toContain("Save template");
  });

  it("names a layout after the title, else Untitled, within the length a name may have", () => {
    expect(defaultTemplateName("  Summer sale ")).toBe("Summer sale");
    expect(defaultTemplateName("")).toBe("Untitled");
    expect(defaultTemplateName("   ")).toBe("Untitled");
    expect(defaultTemplateName("x".repeat(200))).toHaveLength(80);
    expect(SAVED_AS_TEMPLATE).toBe("Saved as a template. Find it under Saved.");
  });
});

describe("the choice of how to use a page layout", () => {
  const pending: PendingLayout = {
    name: "Landing page",
    layout: { pageType: "page", rows: [row("n1"), row("n2")], css: "" },
    foreign: true,
  };
  const written = (id: string): PageRow => ({
    ...row(id),
    columns: [{ id: `${id}-c`, blocks: [{ id: `${id}-b`, type: "heading", text: "Hello", level: 2 }] }],
  });
  const dialog = (rows: PageRow[], over: Partial<ComponentProps<typeof ApplyLayoutDialog>> = {}) =>
    text(
      createElement(ApplyLayoutDialog, {
        pending,
        rows,
        pageCss: "",
        pageType: "page",
        pageSaved: true,
        onApply: () => null,
        onClose: () => {},
        ...over,
      }),
    );

  it("offers to replace the page's layout or add after the current rows", () => {
    const out = dialog([written("a")]);
    expect(out).toContain("Replace this page's layout");
    expect(out).toContain("Add after the current rows");
    expect(out.match(/type="radio"/g)).toHaveLength(2);
    expect(out).toContain("Landing page");
    expect(out).toContain("2 rows");
  });

  it("starts on Add for a page with something on it, so nothing is lost unasked, and on Replace for a blank one", () => {
    expect(dialog([written("a")])).toMatch(/value="add"[^>]*checked=""|checked=""[^>]*value="add"/);
    expect(dialog([row("blank")])).toMatch(/value="replace"[^>]*checked=""|checked=""[^>]*value="replace"/);
    expect(dialog([])).toMatch(/value="replace"[^>]*checked=""|checked=""[^>]*value="replace"/);
  });

  it("refuses a layout the page has no room for, and says why", () => {
    const full = Array.from({ length: ROWS_MAX }, (_, i) => written(`f${i}`));
    const out = dialog(full);
    expect(out).toContain('role="alert"');
    expect(out).toMatch(/at most 50/);
    expect(out).toMatch(/disabled=""[^>]*>Add rows/);
  });

  it("says what happens to the page's CSS", () => {
    const withCss = { ...pending, layout: { ...pending.layout, css: "b{}" } };
    expect(dialog([written("a")], { pending: withCss, pageCss: "a{}" })).toContain("keeps its own custom CSS");
    expect(dialog([written("a")], { pending: withCss })).toContain("custom CSS is added to this page");
  });

  it("draws nothing while there is nothing to choose", () => {
    expect(dialog([], { pending: null })).not.toContain("What should happen?");
  });
});

describe("a saved page layout's dialog", () => {
  const part = {
    ...saved("pl", "private", "Landing page"),
    kind: "page" as const,
    content: { pageType: "article" as const, rows: [row("x")], css: "" },
  };
  const dialog = (fits: boolean) =>
    text(
      createElement(SavedLayoutDialog, {
        actions: fakeActionsForParts(),
        part,
        fits,
        onClose: () => {},
        onParts: () => {},
        onUse: () => {},
      }),
    );
  function fakeActionsForParts() {
    return {
      updatePart: async () => ({ ok: false as const, problems: [] }),
      deletePart: async () => ({ ok: false as const, problems: [] }),
    };
  }

  it("can rename, use and delete it, with no Global option", () => {
    const out = dialog(true);
    expect(out).toContain("Saved page layout");
    expect(out).toContain('value="Landing page"');
    expect(out).toContain("Save name");
    expect(out).toContain("Use on this page");
    expect(out).toContain(">Delete<");
    expect(out).toContain("Made for articles");
    expect(out).not.toContain("Global");
  });

  it("cannot be used on another kind of page, and says so", () => {
    const out = dialog(false);
    expect(out).toMatch(/disabled=""[^>]*>Use on this page/);
    expect(out).toContain("so it cannot be used on this page");
  });
});

describe("asking the server for a template's copy", () => {
  it("passes on the answer, and turns a thrown error into a problem to show", async () => {
    const { actions } = fakeActions({}, { use: { ok: false, problems: ["Gone."] } });
    expect(await fetchTemplate(actions, "x")).toEqual({ ok: false, problems: ["Gone."] });
    const ok = await fetchTemplate(fakeActions().actions, "y");
    expect(ok.ok).toBe(true);
    const broken = { ...actions, use: async () => Promise.reject(new Error("offline")) };
    expect(await fetchTemplate(broken, "z")).toEqual({ ok: false, problems: [USE_PROBLEM] });
  });

  it("previews a template at the address the server gives", () => {
    expect(fakeActions().actions.previewStore).toBe("demo");
  });
});

describe("the builder with page layouts", () => {
  const build = (
    over: Partial<ComponentProps<typeof PageBuilder>> & { templates: ComponentProps<typeof PageBuilder>["templates"] },
  ) =>
    text(
      createElement(PageBuilder, {
        pageType: "page",
        rows: [],
        onRows: () => {},
        saved: [],
        onSaved: () => {},
        upload: null,
        aside: createElement("p", null, "Page title"),
        grid: {
          pageId: null,
          owner: over.templates ? "store-1" : null,
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
        ...over,
      }),
    );

  it("offers to start an empty page from a page layout, only in a store's builder", () => {
    expect(build({ templates: fakeActions().actions })).toContain("Start from a page layout");
    expect(build({ templates: null })).not.toContain("Start from a page layout");
  });

  it("offers it on a page nothing is written on, but not on one with content", () => {
    const blank = build({ templates: fakeActions().actions, rows: [row("r")] });
    expect(blank).toContain("Start from a page layout");
    const written: PageRow = {
      ...row("w"),
      columns: [{ id: "wc", blocks: [{ id: "wb", type: "heading", text: "Hello", level: 2 }] }],
    };
    expect(build({ templates: fakeActions().actions, rows: [written] })).not.toContain("Start from a page layout");
  });

  it("lists saved page layouts as their own group with the kind of page each is for, and Use", () => {
    const layout = {
      ...saved("pl", "private", "Landing page"),
      kind: "page" as const,
      content: { pageType: "article" as const, rows: [row("x"), row("y")], css: "" },
    };
    const mine = {
      ...layout,
      id: "pl2",
      name: "Front page",
      content: { ...layout.content, pageType: "page" as const },
    };
    const out = build({ templates: fakeActions().actions, saved: [layout, mine, saved("p1", "private", "Hero")] });
    expect(out).toContain('aria-label="Page layouts"');
    expect(out.indexOf("Page layouts")).toBeLessThan(out.indexOf('aria-label="Rows"'));
    expect(out).toContain("For articles");
    expect(out).toContain("For pages");
    expect(out).toContain('aria-label="Use page layout Front page"');
    // Another kind of page's layout cannot be used here, and says so.
    expect(out).toMatch(/disabled=""[^>]*aria-label="Use page layout Landing page"/);
    expect(out).toContain("Made for articles, so it cannot be used on pages.");
    // Sharing is managed as for the other saved parts, and there is no Global choice.
    expect(out).toContain('aria-label="Sharing of Landing page"');
    // A layout is not dragged like a row.
    expect(out).not.toContain("saved page layout: open to change or add");
    expect(out).toContain("saved page layout: open to rename, share or delete");
  });

  it("shows saved page layouts on Kaizen's builder too, without any sharing", () => {
    const layout = {
      ...saved("pl", "private", "Landing page"),
      kind: "page" as const,
      content: { pageType: "page" as const, rows: [row("x")], css: "" },
    };
    const out = build({ templates: null, saved: [layout] });
    expect(out).toContain('aria-label="Use page layout Landing page"');
    expect(out).not.toContain("Sharing of");
  });
});
