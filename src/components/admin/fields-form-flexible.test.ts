import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EMPTY_DATA,
  EMPTY_LOOKUPS,
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
 * The entry form for flexible content and money, drawn on the server as the
 * other types are (`fields-form.test.ts`): what a person sees and can use
 * before any script runs.
 */

const MAIN = "nb-NO";

const group = (fields: FieldDef[]): FieldGroup => ({
  id: "g",
  name: "Content",
  slug: "content",
  entities: ["product"],
  location: [],
  fields,
  position: "main",
  active: true,
  sort: 0,
});

const html = (fields: FieldDef[], data: FieldData = EMPTY_DATA, locale = MAIN, lookups: FieldLookups = EMPTY_LOOKUPS) =>
  renderToString(
    createElement(FieldsForm, {
      groups: [group(fields)],
      data,
      onChange: () => {},
      locale,
      main: MAIN,
      upload: null,
      fileUpload: null,
      lookups,
    }),
  ).replace(/<!-- -->/g, "");

const dataWith = (def: FieldDef, value: FieldValue, base: FieldData = EMPTY_DATA): FieldData =>
  writeField(def, base, MAIN, MAIN, value);

const text = (id: string, label: string, over: Partial<FieldDef> = {}): FieldDef => ({
  ...newField("text"),
  id,
  name: label.toLowerCase(),
  label,
  ...over,
});

const heading = text("f_heading00001", "Heading");
const number = { ...newField("number"), id: "f_stars000001", name: "stars", label: "Stars" };
const quote = text("f_quote000001", "Quote text");
const flexible = (over: Partial<FieldDef> = {}): FieldDef => ({
  ...newField("flexible"),
  id: "f_flexible0001",
  name: "content",
  label: "Page content",
  buttonLabel: "Add a section",
  layouts: [
    { key: "text", label: "Text block", labels: { "sv-SE": "Textblock" }, subFields: [heading] },
    { key: "quote", label: "Quote", subFields: [quote, number] },
  ],
  ...over,
});
const rows = [
  { id: "r_aaaaaaaa", layout: "text", [heading.id]: "Hello" },
  { id: "r_bbbbbbbb", layout: "quote", [quote.id]: "Less is more", [number.id]: 5 },
];

describe("the entry form for flexible content", () => {
  it("draws an empty field with its add button, and no layout chooser until it is used", () => {
    const out = html([flexible()]);
    expect(out).toContain("Page content");
    expect(out).toContain("No rows yet.");
    expect(out).toContain("Add a section");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Choose a layout");
  });

  it("draws each row headed by its number and layout, with that layout's fields only", () => {
    const def = flexible();
    const out = html([def], dataWith(def, rows));
    expect(out).toContain("Row 1: Text block");
    expect(out).toContain("Row 2: Quote");
    expect(out).toContain('value="Hello"');
    expect(out).toContain('value="Less is more"');
    expect(out).toContain('value="5"');
    // The first row is a text block: it has a heading but no quote field.
    expect(out.split("Row 2: Quote")[0]).not.toContain("Quote text");
    expect(out).toContain("Heading");
  });

  it("names the row buttons for the row and its layout, so nothing is drag only or unlabeled", () => {
    const def = flexible();
    const out = html([def], dataWith(def, rows));
    for (const label of [
      "Move row 1 (Text block) of Page content down",
      "Move row 2 (Quote) of Page content up",
      "Remove row 2 (Quote) of Page content",
    ]) {
      expect(out).toContain(`aria-label="${label}"`);
    }
    expect(out).toMatch(/aria-label="Move row 1 \(Text block\) of Page content up"[^>]*disabled/);
  });

  it("holds the most rows and asks for the fewest", () => {
    const def = flexible({ maxRows: 2, minRows: 3 });
    const out = html([def], dataWith(def, rows));
    expect(out).toContain("The most is 2 rows.");
    expect(out).toContain("At least 3 rows are needed.");
  });

  it("adds a row of the only layout straight away, without a chooser", () => {
    const one = flexible({ layouts: [{ key: "text", label: "Text block", subFields: [heading] }] });
    expect(html([one])).not.toContain("aria-expanded");
  });

  it("in another language changes only the texts of the rows, whose layout labels are in that language", () => {
    const def = flexible();
    const out = html([def], dataWith(def, rows), "sv-SE");
    expect(out).toContain("Rows are added, removed and moved in nb-NO. Here you write the texts in them.");
    expect(out).toContain("Row 1: Textblock");
    expect(out).toContain("Row 2: Quote");
    expect(out).not.toContain("Add a section");
    expect(out).not.toContain("Remove row");
    // The number is the same in every language: only the row's texts are asked for here.
    expect(out).not.toContain("Stars");
    expect(out).toContain("Quote text");
  });

  it("does not draw a row of a layout that no longer exists", () => {
    const def = flexible();
    const data: FieldData = {
      values: { [def.id]: [...rows, { id: "r_cccccccc", layout: "gone", [heading.id]: "Lost" }] as never },
      translations: {},
    };
    const out = html([def], data);
    expect(out).not.toContain("Row 3");
    expect(out).not.toContain("Lost");
  });
});

describe("the entry form for money", () => {
  const money = { ...newField("money"), id: "f_deposit00001", name: "deposit", label: "Deposit" };
  const lookups: FieldLookups = { ...EMPTY_LOOKUPS, currencies: ["NOK", "EUR", "SEK"] };

  it("draws an amount and a select of the store's currencies, its main one first", () => {
    const out = html([money], EMPTY_DATA, MAIN, lookups);
    expect(out).toContain("Deposit");
    expect(out).toContain('aria-label="Deposit: currency"');
    expect(out).toMatch(
      /<option value="NOK" selected[^>]*>NOK<\/option><option value="EUR">EUR<\/option><option value="SEK">SEK<\/option>/,
    );
  });

  it("shows a saved amount with the currency's decimals, in its own currency", () => {
    const out = html([money], dataWith(money, { amountMinor: 4990, currency: "SEK" }), MAIN, lookups);
    expect(out).toContain('value="49.90"');
    expect(out).toMatch(/<option value="SEK" selected/);
  });

  it("keeps a currency the store no longer offers so what was entered still shows as it is", () => {
    const out = html([money], dataWith(money, { amountMinor: 100, currency: "DKK" }), MAIN, lookups);
    expect(out).toMatch(/<option value="DKK" selected/);
    expect(out).toContain('value="1.00"');
  });

  it("says so when the store offers no currency", () => {
    const out = html([money]);
    expect(out).toContain("No currency");
    expect(out).toContain("disabled");
  });

  it("is drawn inside a repeater's rows and a flexible layout too", () => {
    const def = flexible({
      layouts: [{ key: "price", label: "Cost", subFields: [{ ...money, id: "f_cellmoney001" }] }],
    });
    const out = html(
      [def],
      dataWith(def, [{ id: "r_aaaaaaaa", layout: "price", f_cellmoney001: { amountMinor: 250, currency: "EUR" } }]),
      MAIN,
      lookups,
    );
    expect(out).toContain("Row 1: Cost");
    expect(out).toContain('value="2.50"');
  });
});
