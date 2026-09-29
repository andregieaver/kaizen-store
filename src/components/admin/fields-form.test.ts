import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EMPTY_DATA,
  EMPTY_LOOKUPS,
  FIELD_TYPE_KEYS,
  newField,
  writeField,
  type FieldData,
  type FieldDef,
  type FieldGroup,
  type FieldLookups,
  type FieldValue,
} from "@/lib/custom-fields";

import { FieldsForm } from "./fields-form";

/**
 * The entry form is client code, but it renders on the server too: this holds
 * that every type of field draws, with and without a value, and that a field
 * its logic hides is not drawn.
 */

const MAIN = "nb-NO";

const group = (fields: FieldDef[]): FieldGroup => ({
  id: "g",
  name: "Specs",
  slug: "specs",
  entities: ["product"],
  location: [],
  fields,
  position: "main",
  active: true,
  sort: 0,
});

/** The form drawn on the server, without the markers React leaves between text nodes (they are not what a person reads). */
const html = (
  fields: FieldDef[],
  data: FieldData = { values: {}, translations: {} },
  locale = MAIN,
  lookups: FieldLookups = EMPTY_LOOKUPS,
  fileUpload: Parameters<typeof FieldsForm>[0]["fileUpload"] = null,
) =>
  renderToString(
    createElement(FieldsForm, {
      groups: [group(fields)],
      data,
      onChange: () => {},
      locale,
      main: MAIN,
      upload: null,
      fileUpload,
      lookups,
    }),
  ).replace(/<!-- -->/g, "");

/** Data holding a value for a field in the main language, written the way the form writes it. */
const dataWith = (def: FieldDef, value: FieldValue, base: FieldData = EMPTY_DATA): FieldData =>
  writeField(def, base, MAIN, MAIN, value);

const lookups: FieldLookups = {
  products: [
    { id: "11111111-1111-4111-8111-111111111111", title: "Wool sock" },
    { id: "22222222-2222-4222-8222-222222222222", title: "Linen shirt" },
  ],
  pages: [
    { id: "33333333-3333-4333-8333-333333333333", title: "About us", type: "page" },
    { id: "44444444-4444-4444-8444-444444444444", title: "Spring news", type: "article" },
  ],
  terms: [
    { id: "55555555-5555-4555-8555-555555555555", name: "Socks", kind: "category" },
    { id: "66666666-6666-4666-8666-666666666666", name: "Organic", kind: "tag" },
  ],
};

const sub = (type: Parameters<typeof newField>[0], label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  ...newField(type),
  label,
  ...extra,
});

const repeater = (subFields: FieldDef[], extra: Partial<FieldDef> = {}): FieldDef => ({
  ...newField("repeater"),
  label: "Features",
  buttonLabel: "Add feature",
  subFields,
  ...extra,
});

describe("the entry form for custom fields", () => {
  it("draws every type of field, empty", () => {
    for (const type of FIELD_TYPE_KEYS) {
      const field = { ...newField(type), label: `Label of ${type}` };
      const out = html([field]);
      expect(out, type).toContain(`Label of ${type}`);
    }
  });

  it("draws every type of field, empty, in another language too", () => {
    for (const type of FIELD_TYPE_KEYS) {
      const field = { ...newField(type), label: `Label of ${type}` };
      expect(html([field], EMPTY_DATA, "sv-SE", lookups), type).toContain(`Label of ${type}`);
    }
  });

  it("draws values and marks what only staff see and what is required", () => {
    const text = { ...newField("text"), label: "Material", required: true };
    const choice = {
      ...newField("select"),
      label: "Finish",
      access: "public" as const,
      choices: [{ key: "a", label: "Alpha" }],
    };
    const out = html([text, choice], { values: { [choice.id]: "a" }, translations: { "nb-NO": { [text.id]: "Ull" } } });
    expect(out).toContain('value="Ull"');
    expect(out).toContain("(only staff)");
    expect(out).toContain("Alpha");
    expect(out).toContain("*");
  });

  it("shows a text's main language as the hint while another language's is empty", () => {
    const text = { ...newField("text"), label: "Material" };
    const out = html([text], { values: {}, translations: { "nb-NO": { [text.id]: "Ull" } } }, "sv-SE");
    expect(out).toContain('placeholder="nb-NO: Ull"');
    // The main language's words are a hint, not the value: the input itself is empty.
    expect(out).toContain('value=""');
    expect(out).not.toContain('value="Ull"');
  });

  it("leaves out a field its logic hides", () => {
    const trigger = { ...newField("boolean"), label: "Has warranty" };
    const shy = {
      ...newField("text"),
      label: "Warranty terms",
      when: [[{ field: trigger.id, operator: "==" as const, value: "1" }]],
    };
    expect(html([trigger, shy])).not.toContain("Warranty terms");
    expect(html([trigger, shy], { values: { [trigger.id]: true }, translations: {} })).toContain("Warranty terms");
  });

  it("says so when a group has no fields", () => {
    expect(html([])).toContain("no fields yet");
  });
});

describe("links", () => {
  it("draws a link to a web address, with its words and new tab choice", () => {
    const link = { ...newField("link"), label: "Data sheet" };
    const data = dataWith(link, { kind: "url", ref: "https://example.com/a", label: "Read it", newTab: true });
    const out = html([link], data);
    expect(out).toContain('value="https://example.com/a"');
    expect(out).toContain('value="Read it"');
    expect(out).toContain("Open in a new tab");
    expect(out).toContain('checked=""');
    expect(out).toContain("Link text");
  });

  it("offers the store's pages, with articles marked, for a link to a page", () => {
    const link = { ...newField("link"), label: "More" };
    const data = dataWith(link, { kind: "page", ref: lookups.pages[1].id, label: "" });
    const out = html([link], data, MAIN, lookups);
    expect(out).toContain("Spring news (article)");
    expect(out).toContain("About us");
    expect(out).not.toContain("Wool sock");
  });

  it("offers only the categories for a link to a category", () => {
    const link = { ...newField("link"), label: "Shop" };
    const out = html([link], dataWith(link, { kind: "category", ref: "", label: "" }), MAIN, lookups);
    expect(out).toContain("Socks");
    expect(out).not.toContain("Organic");
  });

  it("draws an empty link with only the kind to choose, and hints at the main language's link in another", () => {
    const link = { ...newField("link"), label: "More" };
    const empty = html([link]);
    expect(empty).toContain("Choose what to link to");
    expect(empty).not.toContain("Link text");
    const data = dataWith(link, { kind: "url", ref: "https://example.com", label: "Docs" });
    const other = html([link], data, "sv-SE");
    expect(other).toContain("Empty: shoppers see the nb-NO link (Docs).");
  });
});

describe("relational fields", () => {
  it("draws one product as a list with the chosen one selected", () => {
    const product = { ...newField("product"), label: "Related" };
    const out = html([product], dataWith(product, lookups.products[1].id), MAIN, lookups);
    expect(out).toContain("Wool sock");
    expect(out).toMatch(/<option value="22222222-2222-4222-8222-222222222222" selected="">Linen shirt<\/option>/);
    expect(out).not.toContain("Move Linen shirt up");
  });

  it("draws several as a chosen list to order and remove, and a control to add more", () => {
    const products = { ...newField("product"), label: "Goes with", multiple: true };
    const ids = lookups.products.map((p) => p.id);
    const out = html([products], dataWith(products, ids), MAIN, lookups);
    expect(out).toContain('aria-label="Goes with: chosen"');
    expect(out).toContain('aria-label="Move Wool sock down"');
    expect(out).toContain('aria-label="Move Linen shirt up"');
    expect(out).toContain('aria-label="Remove Wool sock"');
    expect(out).toContain("Everything is chosen");
  });

  it("offers what is left to add", () => {
    const pages = { ...newField("page"), label: "Read more", multiple: true };
    const out = html([pages], dataWith(pages, [lookups.pages[0].id]), MAIN, lookups);
    expect(out).toContain("Choose one to add");
    expect(out).toContain("Spring news (article)");
    expect(out).toContain('aria-label="Remove About us"');
    expect(out).toContain('aria-label="Choose Read more to add"');
  });

  it("filters categories and tags by the kinds the field allows", () => {
    const tags = { ...newField("term"), label: "Themes", termKinds: ["tag" as const] };
    const onlyTags = html([tags], EMPTY_DATA, MAIN, lookups);
    expect(onlyTags).toContain("Organic");
    expect(onlyTags).not.toContain("Socks");
    const both = html([{ ...tags, termKinds: ["category" as const, "tag" as const] }], EMPTY_DATA, MAIN, lookups);
    expect(both).toContain("Socks (category)");
    expect(both).toContain("Organic (tag)");
  });

  it("says so when there is nothing to choose from, and keeps an id that is gone", () => {
    const product = { ...newField("product"), label: "Related" };
    expect(html([product])).toContain("Nothing to choose from yet.");
    const gone = html([product], dataWith(product, "77777777-7777-4777-8777-777777777777"), MAIN, lookups);
    expect(gone).toContain("A removed one");
  });
});

describe("files", () => {
  const file = { url: "https://x.test/f/spec.pdf", name: "spec.pdf", size: 2048, contentType: "application/pdf" };

  it("draws a file with its name and size and a way to remove or replace it", () => {
    const def = { ...newField("file"), label: "Manual" };
    const upload = async () => file;
    const out = html([def], dataWith(def, file), MAIN, EMPTY_LOOKUPS, upload);
    expect(out).toContain("spec.pdf");
    expect(out).toContain("2 KB");
    expect(out).toContain('aria-label="Remove the file from Manual"');
    expect(out).toContain("Replace file");
    expect(out).toContain('accept=".pdf,');
  });

  it("offers to choose a file when it is empty, and says when uploads are not set up", () => {
    const def = { ...newField("file"), label: "Manual" };
    expect(html([def], EMPTY_DATA, MAIN, EMPTY_LOOKUPS, async () => file)).toContain("Choose file");
    expect(html([def])).toContain("Uploads are not set up here.");
  });
});

describe("groups", () => {
  const make = () => {
    const width = sub("number", "Width", { width: 50 });
    const finish = sub("text", "Finish", { width: 50 });
    const flag = sub("boolean", "Custom");
    const why = sub("text", "Why custom", { when: [[{ field: flag.id, operator: "==" as const, value: "1" }]] });
    const def = { ...newField("group"), label: "Dimensions", subFields: [width, finish, flag, why] };
    return { def, width, finish, flag, why };
  };

  it("draws its fields in a fieldset, empty", () => {
    const { def } = make();
    const out = html([def]);
    expect(out).toContain("Dimensions");
    expect(out).toContain("Width");
    expect(out).toContain("Finish");
    expect(out).toContain("Custom");
    // Widths follow the sub fields' own.
    expect(out).toContain("calc(50% - 1rem)");
    // A sub field's access is its group's: no repeated marker, one on the group.
    expect(out.match(/\(only staff\)/g)).toHaveLength(1);
  });

  it("evaluates a sub field's logic over the group's own values", () => {
    const { def, flag } = make();
    expect(html([def])).not.toContain("Why custom");
    expect(html([def], dataWith(def, { [flag.id]: true }))).toContain("Why custom");
  });

  it("draws its values", () => {
    const { def, width, finish } = make();
    const out = html([def], dataWith(def, { [width.id]: 12, [finish.id]: "Matt" }));
    expect(out).toContain('value="12"');
    expect(out).toContain('value="Matt"');
  });

  it("shows only its texts in another language, with the main language's as the hint", () => {
    const { def, width, finish } = make();
    const data = dataWith(def, { [width.id]: 12, [finish.id]: "Matt" });
    const out = html([def], data, "sv-SE");
    expect(out).toContain("Finish");
    expect(out).toContain('placeholder="nb-NO: Matt"');
    expect(out).not.toContain("Width");
    expect(out).toContain("Only its texts are written per language");
  });

  it("says so in another language when nothing in it is translated", () => {
    const only = { ...newField("group"), label: "Numbers", subFields: [sub("number", "Width")] };
    const out = html([only], EMPTY_DATA, "sv-SE");
    expect(out).toContain("Nothing in it is translated. Change it in nb-NO.");
    expect(out).not.toContain(">Width");
  });
});

describe("repeaters", () => {
  const title = sub("text", "Title", { width: 50 });
  const score = sub("number", "Score", { width: 50 });
  const rows = [
    { id: "r_aaaaaa11", [title.id]: "Fast", [score.id]: 5 },
    { id: "r_bbbbbb22", [title.id]: "Light", [score.id]: 3 },
  ];

  it("draws an empty repeater with a button that adds a row", () => {
    const out = html([repeater([title, score])]);
    expect(out).toContain("Features");
    expect(out).toContain("No rows yet.");
    expect(out).toContain("Add feature");
  });

  it("draws rows as blocks with buttons named for the row", () => {
    const def = repeater([title, score], { rowLayout: "block" });
    const out = html([def], dataWith(def, rows));
    expect(out).not.toContain("<table");
    expect(out).toContain("Row 1");
    expect(out).toContain("Row 2");
    expect(out).toContain('value="Fast"');
    expect(out).toContain('value="Light"');
    expect(out).toContain('value="5"');
    expect(out).toContain('aria-label="Move row 1 of Features down"');
    expect(out).toContain('aria-label="Move row 2 of Features up"');
    expect(out).toContain('aria-label="Remove row 2 of Features"');
    // The first row cannot move up, the last cannot move down.
    expect(out).toMatch(
      /aria-label="Move row 1 of Features up"[^>]*disabled=""|disabled=""[^>]*aria-label="Move row 1 of Features up"/,
    );
  });

  it("draws rows as a table with a column for each sub field", () => {
    const def = repeater([title, score], { rowLayout: "table" });
    const out = html([def], dataWith(def, rows));
    expect(out).toContain("<table");
    expect(out).toMatch(/<th[^>]*>Title/);
    expect(out).toMatch(/<th[^>]*>Score/);
    expect(out).toContain('value="Fast"');
    // Each cell is named for its row, for screen readers.
    expect(out).toContain("Title, row 2");
    expect(out).toContain('aria-label="Remove row 1 of Features"');
  });

  it("keeps the table's cells of a hidden sub field empty, and the block's out", () => {
    const flag = sub("boolean", "Special");
    const why = sub("text", "Reason", { when: [[{ field: flag.id, operator: "==" as const, value: "1" }]] });
    const block = repeater([flag, why], { rowLayout: "block" });
    const data = dataWith(block, [{ id: "r_aaaaaa11", [flag.id]: true, [why.id]: "Gift" }, { id: "r_bbbbbb22" }]);
    const out = html([block], data);
    // Only the first row shows its reason.
    expect(out.match(/Reason/g)).toHaveLength(1);
    expect(out).toContain('value="Gift"');
    const table = { ...block, rowLayout: "table" as const };
    const tableOut = html(
      [table],
      dataWith(table, [{ id: "r_aaaaaa11", [flag.id]: true, [why.id]: "Gift" }, { id: "r_bbbbbb22" }]),
    );
    expect(tableOut).not.toContain("Reason, row 2");
    expect(tableOut).toContain("Reason, row 1");
  });

  it("disables adding at the most rows, and says how few it needs", () => {
    const def = repeater([title], { maxRows: 2, minRows: 3 });
    const out = html([def], dataWith(def, rows));
    expect(out).toContain("The most is 2 rows.");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Add feature<\/button>/);
    expect(out).toContain("At least 3 rows are needed.");
    // At the fewest, a row cannot be removed.
    expect(out).toMatch(
      /aria-label="Remove row 1 of Features"[^>]*disabled=""|disabled=""[^>]*aria-label="Remove row 1 of Features"/,
    );
  });

  it("offers only the texts, row by row, in another language, with no way to change the rows", () => {
    for (const rowLayout of ["block", "table"] as const) {
      const def = repeater([title, score], { rowLayout });
      const out = html([def], dataWith(def, rows), "sv-SE");
      expect(out, rowLayout).toContain("Title");
      expect(out, rowLayout).not.toContain("Score");
      expect(out, rowLayout).toContain('placeholder="nb-NO: Fast"');
      expect(out, rowLayout).toContain('placeholder="nb-NO: Light"');
      expect(out, rowLayout).not.toContain("Add feature");
      expect(out, rowLayout).not.toContain("Remove row");
      expect(out, rowLayout).not.toContain("Move row");
      expect(out, rowLayout).toContain("Rows are added, removed and moved in nb-NO.");
    }
  });

  it("shows the language's own words in the rows it has written", () => {
    const def = repeater([title], { rowLayout: "block" });
    const base = dataWith(def, rows);
    const data = writeField(def, base, "sv-SE", MAIN, [
      { id: "r_aaaaaa11", [title.id]: "Snabb" },
      { id: "r_bbbbbb22" },
    ]);
    const out = html([def], data, "sv-SE");
    expect(out).toContain('value="Snabb"');
    expect(out).toContain('placeholder="nb-NO: Light"');
  });

  it("says so in another language when its rows hold no texts, and when there are no rows", () => {
    const numbers = repeater([score]);
    expect(html([numbers], dataWith(numbers, rows), "sv-SE")).toContain("Nothing in its rows is translated.");
    expect(html([repeater([title])], EMPTY_DATA, "sv-SE")).toContain("No rows yet. Add them in nb-NO.");
  });

  it("draws every kind of field a row can hold", () => {
    const kinds = FIELD_TYPE_KEYS.filter((type) => type !== "group" && type !== "repeater");
    for (const rowLayout of ["block", "table"] as const) {
      const subs = kinds.map((type) => sub(type, `Sub ${type}`));
      const def = repeater(subs, { rowLayout });
      const out = html([def], dataWith(def, [{ id: "r_aaaaaa11" }]), MAIN, lookups);
      for (const type of kinds) expect(out, `${rowLayout} ${type}`).toContain(`Sub ${type}`);
    }
  });
});
