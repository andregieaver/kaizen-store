import { describe, expect, it } from "vitest";

import {
  BRAND_FIELDS,
  DESIGN_SNAPSHOT_VERSION,
  LOOK_FIELDS,
  beforeThemeName,
  designChoice,
  designPageSlug,
  designPreviewPath,
  designSnapshotSchema,
  keepDesignCard,
  layoutForStore,
  mapSnapshotMedia,
  parseDesignDetails,
  parseDesignSnapshot,
  snapshotFonts,
  snapshotLayout,
  snapshotStorageUrls,
  type DesignSnapshot,
} from "./design-presets";
import { pageInput, type PageBlock, type PageContent } from "./page-content";
import { newBlock } from "./page-rows";
import { defaultFooter, defaultHeader } from "./site-layout";
import { templateSettings, themeSettingsSchema } from "./theme";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const HEADER_MENU = "22222222-2222-4222-8222-222222222222";
const FOOTER_MENU = "33333333-3333-4333-8333-333333333333";
const OTHER_MENU = "44444444-4444-4444-8444-444444444444";
const TARGET_HEADER_MENU = "55555555-5555-4555-8555-555555555555";
const from = { id: SOURCE, slug: "nordic-spa", hosts: ["nordic-spa.example.com"] };
const menus = { header: HEADER_MENU, footer: FOOTER_MENU };
const STORAGE = "https://x.supabase.co/storage/v1/object/public/product-images/source/hero.webp";

let n = 0;
const id = () => `b${(n += 1)}`;

/** A header as a store could hold it: the standard one, plus things that point into the store. */
function sourceHeader(): PageContent {
  const header = defaultHeader(SOURCE, { header: HEADER_MENU, footer: FOOTER_MENU });
  const button = { ...(newBlock("button", id) as Extract<PageBlock, { type: "button" }>), label: "Book", href: "/s/nordic-spa/no/p/massage" };
  const mail = { ...(newBlock("button", id) as Extract<PageBlock, { type: "button" }>), label: "Mail us", href: "mailto:owner@nordic-spa.no" };
  const outside = { ...(newBlock("button", id) as Extract<PageBlock, { type: "button" }>), label: "Blog", href: "https://example.org/blog" };
  const field = newBlock("customField", id);
  const other = { ...newBlock("menu", id), menuId: OTHER_MENU } as PageBlock;
  const image = { ...(newBlock("image", id) as Extract<PageBlock, { type: "image" }>), image: { url: STORAGE, width: 800, height: 400, alt: "Ferns" } };
  const row = header.rows[0];
  const content: PageContent = {
    ...header,
    rows: [row, { id: id(), type: "row", layout: "1", columns: [{ id: id(), blocks: [button, mail, outside, field, other, image] }] }],
    css: ".site-header { letter-spacing: .02em }",
    overlay: { where: "front", categories: [], tags: [], textColor: "#ffffff" },
  };
  const parsed = pageInput.safeParse(content);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
  return parsed.data;
}

const blocksOf = (content: { rows: PageContent["rows"] }) => content.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));

function snapshotOf(): DesignSnapshot {
  const header = snapshotLayout(sourceHeader(), "header", menus, from).layout;
  const footer = snapshotLayout(defaultFooter(SOURCE, menus), "footer", menus, from).layout;
  const parsed = parseDesignSnapshot({
    v: DESIGN_SNAPSHOT_VERSION,
    theme: { base: "warm", settings: templateSettings("warm") },
    header,
    footer,
    productLayout: null,
    css: "body { word-spacing: .05em }",
  });
  if (!parsed) throw new Error("snapshot did not parse");
  return parsed;
}

describe("what a design profile holds (D176)", () => {
  it("keeps the look and the brand apart: no column is both, and a theme holds no logo, icon or name", () => {
    expect(LOOK_FIELDS.filter((f) => (BRAND_FIELDS as readonly string[]).includes(f))).toEqual([]);
    expect(BRAND_FIELDS).toEqual(expect.arrayContaining(["name", "navigation", "header_menu_id", "footer_menu_id", "legal_name"]));
    const keys = JSON.stringify(themeSettingsSchema.parse(templateSettings("bold")));
    for (const brand of ["logo", "favicon", "navigation", "legalName", "\"name\""]) expect(keys).not.toContain(brand);
  });

  it("reads a snapshot of version 1 only, and drops anything else it is given", () => {
    const snapshot = snapshotOf();
    const extra = parseDesignSnapshot({ ...snapshot, navigation: { logo: { url: "https://x/logo.png" } }, name: "Nordic Spa" });
    expect(extra).not.toBeNull();
    expect(Object.keys(extra!).sort()).toEqual(["css", "footer", "header", "productLayout", "theme", "v"]);
    expect(parseDesignSnapshot({ ...snapshot, v: 2 })).toBeNull();
    expect(designSnapshotSchema.safeParse({ ...snapshot, css: "body { background: url(javascript:alert(1)) }" }).success).toBe(false);
  });

  it("names the theme's fonts and the blocks' own as what must be installed", () => {
    expect(snapshotFonts(snapshotOf())).toEqual(expect.arrayContaining(["Playfair Display", "Lora"]));
  });
});

describe("taking a snapshot of a layout", () => {
  const { layout, notes } = snapshotLayout(sourceHeader(), "header", menus, from);
  const blocks = blocksOf(layout);
  const json = JSON.stringify(layout);

  it("names each menu by its role, and keeps no menu's id", () => {
    const headerMenu = blocks.find((b) => b.type === "menu" && layout.menus[b.id] === "header");
    expect(headerMenu).toBeDefined();
    expect(Object.values(layout.menus)).toEqual(["header"]);
    for (const menuId of [HEADER_MENU, FOOTER_MENU, OTHER_MENU]) expect(json).not.toContain(menuId);
    expect(notes.otherMenus).toBe(1);
  });

  it("leaves out the store's own fields, links into the store and its contact details, and keeps links elsewhere", () => {
    expect(blocks.some((b) => b.type === "customField")).toBe(false);
    expect(notes.fieldBlocks).toBe(1);
    expect(json).not.toContain("/s/nordic-spa");
    expect(json).not.toContain("mailto:");
    expect(json).toContain("https://example.org/blog");
    expect(json).not.toContain(SOURCE);
  });

  it("keeps the CSS, a header's place over the front page, and the pictures for copying", () => {
    expect(layout.css).toContain("letter-spacing");
    expect(layout.overlay).toEqual({ where: "front", textColor: "#ffffff" });
    expect(json).toContain(STORAGE);
  });

  it("drops CSS that reaches into a store's files, and a header lying over the store's own categories", () => {
    const header = sourceHeader();
    const taken = snapshotLayout(
      { ...header, css: `.x { background-image: url(${STORAGE}) }`, overlay: { where: "terms", categories: [SOURCE], tags: [], textColor: "#ffffff" } },
      "header",
      menus,
      from,
    );
    expect(taken.layout.css).toBe("");
    expect(taken.layout.overlay).toBeUndefined();
    expect(taken.notes).toMatchObject({ cssDropped: true, overlayDropped: true });
  });
});

describe("applying a snapshot in another store", () => {
  const snapshot = snapshotOf();

  it("shows the store's own menu of each role, none where it has none, as a page the builder accepts", () => {
    const page = layoutForStore(snapshot.header!, { header: TARGET_HEADER_MENU, footer: null }, { title: "Calm header", slug: "header-calm" });
    const menuBlocks = blocksOf(page).filter((b) => b.type === "menu");
    expect(menuBlocks.map((b) => (b as { menuId?: string }).menuId).filter(Boolean)).toEqual([TARGET_HEADER_MENU]);
    expect(page.overlay).toEqual({ where: "front", categories: [], tags: [], textColor: "#ffffff" });
    expect(pageInput.safeParse(page).success).toBe(true);
    const footer = layoutForStore(snapshot.footer!, { header: null, footer: null }, { title: "Calm footer", slug: "footer-calm" });
    expect(blocksOf(footer).filter((b) => b.type === "menu").every((b) => !(b as { menuId?: string }).menuId)).toBe(true);
  });

  it("lists the source's uploads once and swaps them for the store's copies, leaving out what was not copied", () => {
    expect(snapshotStorageUrls(snapshot)).toEqual([STORAGE]);
    const copied = mapSnapshotMedia(snapshot, (url) => (url === STORAGE ? "https://x.supabase.co/storage/v1/object/public/product-images/target/a.webp" : url));
    expect(JSON.stringify(copied)).not.toContain(STORAGE);
    expect(JSON.stringify(copied)).toContain("/target/a.webp");
    const left = mapSnapshotMedia(snapshot, (url) => (url === STORAGE ? null : url));
    expect(snapshotStorageUrls(left)).toEqual([]);
  });

  it("keeps the look from before under a name of its own, within a saved theme's 60 characters", () => {
    const name = beforeThemeName("Nordic calm", "2026-10-07", []);
    expect(name).toBe("Before Nordic calm (2026-10-07)");
    expect(beforeThemeName("Nordic calm", "2026-10-07", [name.toUpperCase()])).toBe("Before Nordic calm (2026-10-07) 2");
    const long = beforeThemeName("A very long design profile title that goes on and on and on", "2026-10-07", []);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("(2026-10-07)")).toBe(true);
  });

  it("gives the pages it makes free addresses of the page's form", () => {
    expect(designPageSlug("header", "Nordic calm", [])).toBe("header-nordic-calm");
    expect(designPageSlug("productLayout", "Nordic calm", ["product-layout-nordic-calm"])).toBe("product-layout-nordic-calm-2");
    expect(designPageSlug("footer", "Ærlig & Øko", [])).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("details, choices and cards", () => {
  it("reads a profile's details and says what is wrong in plain words", () => {
    expect(parseDesignDetails({ title: " Nordic calm ", summary: "Quiet", pictureUrl: "/storage/x.webp" })).toEqual({
      ok: true,
      details: { title: "Nordic calm", summary: "Quiet", description: "", pictureUrl: "/storage/x.webp" },
    });
    expect(parseDesignDetails({ title: "", pictureUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, problems: expect.arrayContaining(["Enter a title."]) });
  });

  it("takes a profile's id or nothing from a form", () => {
    expect(designChoice("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(designChoice("")).toBeNull();
    expect(designChoice("nordic")).toBeNull();
  });

  it("offers keeping the template's own design first, with no preview of its own", () => {
    expect(keepDesignCard()).toMatchObject({ id: "", previewHref: null });
    expect(designPreviewPath("p1", "s1", true)).toBe("/admin/account/design-profiles/p1/preview?starter=s1&as=admin");
    expect(designPreviewPath("p1")).toBe("/admin/account/design-profiles/p1/preview");
  });
});
