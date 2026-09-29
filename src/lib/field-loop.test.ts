import { describe, expect, it } from "vitest";

import type { FieldDef, ShownField, ShownGroup } from "./custom-fields";
import {
  fitsSlot,
  loopField,
  loopHeading,
  loopOf,
  loopRows,
  loopShows,
  productLoopConfig,
  productLoopPatch,
  slotChoices,
  suggestSlots,
  validSlots,
} from "./field-loop";
import { blockHasContent, blockText, newPageContent, pageInput, type PageBlock } from "./page-content";
import { newBlock } from "./page-rows";
import { mapBlockTexts } from "./page-translation";

const sub = (id: string, type: FieldDef["type"], label = id): FieldDef => ({
  id,
  name: id,
  label,
  type,
  access: "public",
});
const repeater = (subFields: FieldDef[]): FieldDef => ({
  id: "f_features",
  name: "features",
  label: "Features",
  type: "repeater",
  access: "public",
  subFields,
});

const def = repeater([
  sub("f_picture", "image"),
  sub("f_headline", "text"),
  sub("f_summary", "textarea"),
  sub("f_morelk", "link"),
  sub("f_kindsel", "select"),
  sub("f_stockflag", "boolean"),
  sub("f_pricenum", "number"),
]);

const cell = (id: string, type: ShownField["type"], text: string, extra: Partial<ShownField> = {}): ShownField => ({
  id,
  name: id,
  label: id,
  type,
  value: text,
  text,
  ...extra,
});
const picture = (id = "f_picture") =>
  cell(id, "image", "", { value: { url: "https://cdn.example.com/a.webp", thumbnailUrl: null, alt: "A" } });
const link = (id = "f_morelk", href = "/s/shop/no/care", label = "Care guide") =>
  cell(id, "link", label, { links: [{ label, href }] });
const rows: ShownField[][] = [
  [picture(), cell("f_headline", "text", "Legs"), cell("f_summary", "textarea", "Four solid legs"), link()],
  [cell("f_headline", "text", "Seat"), cell("f_kindsel", "select", "New")],
];
const shownRepeater: ShownField = { ...cell("f_features", "repeater", ""), value: [] as never, rows };
const groups: ShownGroup[] = [{ id: "g1", name: "Specs", slug: "specs", position: "main", fields: [shownRepeater] }];
const slots = { image: "f_picture", title: "f_headline", text: "f_summary", link: "f_morelk", badge: "f_kindsel" };

describe("which sub field fits which slot (D120)", () => {
  it("offers pictures to the picture, text-like to titles and badges, long text to the text, links and files to the link", () => {
    expect(slotChoices(def, "image").map((s) => s.id)).toEqual(["f_picture"]);
    expect(slotChoices(def, "title").map((s) => s.id)).toEqual(["f_headline", "f_kindsel", "f_pricenum"]);
    expect(slotChoices(def, "badge").map((s) => s.id)).toEqual(["f_headline", "f_kindsel", "f_pricenum"]);
    expect(slotChoices(def, "text").map((s) => s.id)).toEqual(["f_headline", "f_summary"]);
    expect(slotChoices(def, "link").map((s) => s.id)).toEqual(["f_morelk"]);
    expect(fitsSlot("link", "file")).toBe(true);
    expect(fitsSlot("image", "gallery")).toBe(false);
    expect(fitsSlot("title", "repeater")).toBe(false);
  });

  it("suggests a slot each, using no sub field twice", () => {
    expect(suggestSlots(def)).toEqual({
      image: "f_picture",
      title: "f_headline",
      text: "f_summary",
      link: "f_morelk",
      badge: "f_kindsel",
    });
    expect(suggestSlots(repeater([sub("f_a", "text"), sub("f_b", "text")]))).toEqual({ title: "f_a", text: "f_b" });
    expect(suggestSlots(repeater([]))).toEqual({});
  });

  it("drops slots naming a sub field that is gone or no longer fits", () => {
    expect(validSlots(def, { ...slots, image: "f_gone", link: "f_headline" })).toEqual({
      title: "f_headline",
      text: "f_summary",
      badge: "f_kindsel",
    });
    expect(validSlots(def, undefined)).toEqual({});
  });
});

describe("a repeater's rows as slots (D120)", () => {
  it("gives each row what its slots name, and drops a row that gives nothing", () => {
    const out = loopRows(shownRepeater, slots);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      image: { url: "https://cdn.example.com/a.webp", thumbnailUrl: null, alt: "A" },
      title: "Legs",
      text: { kind: "plain", text: "Four solid legs" },
      link: { label: "Care guide", href: "/s/shop/no/care", image: null },
    });
    expect(out[1]).toEqual({ title: "Seat", badge: "New" });
    // Only the slots that are chosen: the third row's cells are not named by any slot.
    const other = { ...shownRepeater, rows: [...rows, [cell("f_pricenum", "number", "3")]] };
    expect(loopRows(other, slots)).toHaveLength(2);
    expect(loopRows(other, { title: "f_pricenum" })).toHaveLength(1);
  });

  it("draws nothing for a slot with no slots chosen, a missing repeater or another kind of field", () => {
    expect(loopRows(shownRepeater, {})).toEqual([]);
    expect(loopRows(shownRepeater, undefined)).toEqual([]);
    expect(loopRows(null, slots)).toEqual([]);
    expect(loopRows(cell("f_x", "text", "x"), slots)).toEqual([]);
  });

  it("ignores a cell whose kind does not fit the slot, an unsafe picture and an unsafe link", () => {
    const bad: ShownField[][] = [
      [
        cell("f_picture", "image", "", { value: { url: "javascript:alert(1)", alt: "" } as never }),
        cell("f_morelk", "link", "Go", { links: [{ label: "Go", href: "javascript:alert(1)" }] }),
        cell("f_stockflag", "boolean", "Yes"),
      ],
    ];
    expect(loopRows({ ...shownRepeater, rows: bad }, { ...slots, title: "f_stockflag" })).toEqual([]);
  });

  it("keeps rich text as a document to draw as elements", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich" }] }] };
    const rich: ShownField[][] = [[cell("f_summary", "richText", "Rich", { value: doc as never })]];
    expect(loopRows({ ...shownRepeater, rows: rich }, { text: "f_summary" })).toEqual([
      { text: { kind: "rich", doc } },
    ]);
  });

  it("finds the repeater among the groups, and only a repeater", () => {
    expect(loopField(groups, "f_features")).toBe(shownRepeater);
    expect(loopField(groups, "f_other")).toBeNull();
    expect(loopField(groups, undefined)).toBeNull();
    const plain = [{ ...groups[0], fields: [cell("f_features", "text", "x")] }];
    expect(loopField(plain, "f_features")).toBeNull();
  });

  it("shows only when a row has something to draw", () => {
    expect(loopShows(groups, { fieldId: "f_features", slots })).toBe(true);
    expect(loopShows(groups, { fieldId: "f_features", slots: {} })).toBe(false);
    expect(loopShows([], { fieldId: "f_features", slots })).toBe(false);
    expect(loopOf(groups, { fieldId: "f_features", slots: { title: "f_headline" } })).toEqual([
      { title: "Legs" },
      { title: "Seat" },
    ]);
  });

  it("words its heading only when the owner wrote one", () => {
    expect(loopHeading({})).toBeNull();
    expect(loopHeading({ heading: "  What is in it " })).toBe("What is in it");
    expect(loopHeading({ heading: "x", showHeading: false })).toBeNull();
  });
});

describe("a product layout's loop part (D120)", () => {
  it("reads the page block's settings from the part", () => {
    expect(
      productLoopConfig({
        fieldId: "f_features",
        heading: "Features",
        loop: { layout: "list", slots, linkWholeCard: true },
      }),
    ).toMatchObject({ fieldId: "f_features", heading: "Features", layout: "list", slots, linkWholeCard: true });
  });

  it("puts the layout, columns, slots and link in the part's loop, and the rest in the part", () => {
    expect(productLoopPatch({ loop: { layout: "list" } }, { fieldId: "f_features", groupId: "g", slots })).toEqual({
      fieldId: "f_features",
      groupId: "g",
      loop: { layout: "list", slots },
    });
    expect(productLoopPatch({ loop: { layout: "list", columns: 4 } }, { layout: undefined })).toEqual({
      loop: { columns: 4 },
    });
    expect(productLoopPatch({ loop: { layout: "list" } }, { layout: undefined })).toEqual({ loop: undefined });
    expect(productLoopPatch({}, { heading: "H" })).toEqual({ heading: "H" });
  });
});

describe("the field loop as a page block (D120)", () => {
  const row = (blocks: unknown[]) => ({ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] });
  const input = (blocks: unknown[]) => ({ ...newPageContent(), title: "T", slug: "t", rows: [row(blocks)] });
  const loop = {
    id: "b1",
    type: "fieldLoop",
    fieldId: "f_features",
    layout: "grid",
    columns: 4,
    slots,
    linkWholeCard: true,
    heading: "Features",
  };

  it("starts unconfigured, and counts as content once a repeater is chosen", () => {
    const block = newBlock("fieldLoop", () => "b1") as PageBlock;
    expect(block).toMatchObject({ type: "fieldLoop", layout: "cards", columns: 3, slots: {} });
    expect(blockHasContent(block)).toBe(false);
    expect(blockHasContent({ ...block, fieldId: "f_features" } as PageBlock)).toBe(true);
    expect(blockText(block)).toBe("");
    expect(pageInput.safeParse(input([block])).success).toBe(true);
  });

  it("survives saving with its settings", () => {
    const parsed = pageInput.parse(input([loop]));
    expect(parsed.rows[0].columns[0].blocks[0]).toMatchObject(loop);
  });

  it("refuses an unknown layout, column count, field or slot", () => {
    for (const bad of [
      { layout: "carousel" },
      { columns: 5 },
      { fieldId: "features" },
      { slots: { title: "name" } },
      { heading: "x".repeat(400) },
    ]) {
      expect(pageInput.safeParse(input([{ ...loop, ...bad }])).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("translates only its own heading", () => {
    const seen: string[] = [];
    mapBlockTexts(loop as unknown as PageBlock, (key, value) => {
      seen.push(key);
      return value;
    });
    expect(seen).toEqual(["block.b1.heading"]);
    mapBlockTexts({ ...loop, heading: undefined } as unknown as PageBlock, (key, value) => {
      seen.push(key);
      return value;
    });
    expect(seen).toHaveLength(1);
  });

  it("is a part of a product layout with its own settings", () => {
    const part = { id: "p1", type: "product", part: "loop", fieldId: "f_features", loop: { layout: "list", slots } };
    const parsed = pageInput.safeParse(input([part]));
    expect(parsed.success).toBe(true);
    expect(pageInput.safeParse(input([{ ...part, loop: { layout: "wide" } }])).success).toBe(false);
  });
});

describe("fields on a content grid's tiles (D120)", () => {
  const row = (blocks: unknown[]) => ({ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] });
  const grid = (extra: Record<string, unknown>) => ({
    ...newPageContent(),
    title: "T",
    slug: "t",
    rows: [row([{ ...newBlock("contentGrid", () => "g1"), ...extra }])],
  });

  it("keeps up to three field ids", () => {
    const parsed = pageInput.parse(grid({ tileFields: ["f_aaaaaa", "f_bbbbbb", "f_cccccc"] }));
    expect(parsed.rows[0].columns[0].blocks[0]).toMatchObject({ tileFields: ["f_aaaaaa", "f_bbbbbb", "f_cccccc"] });
    expect(pageInput.safeParse(grid({})).success).toBe(true);
  });

  it("refuses a fourth field and something that is not a field's id", () => {
    expect(pageInput.safeParse(grid({ tileFields: ["f_aaaaaa", "f_bbbbbb", "f_cccccc", "f_dddddd"] })).success).toBe(
      false,
    );
    expect(pageInput.safeParse(grid({ tileFields: ["colour"] })).success).toBe(false);
  });
});
