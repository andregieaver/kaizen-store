import { describe, expect, it } from "vitest";

import { parseCsv, writeCsv, type DialectId } from "./csv";
import {
  CATEGORY_PATH_SEPARATOR,
  addressableFields,
  ambiguousFieldNames,
  groupProducts,
  isVariantRow,
  optionNamesOf,
  orderedPictures,
  parseTermList,
  priceBasisOf,
  productColumns,
  productFileRows,
  productRowsOf,
  readNeutral,
  rowCountOf,
  termPath,
} from "./product-csv";
import { planImport } from "./product-import";
import { C2, C3, C9, FIELDS, TERMS, VARIANT_IDS, boot, context, env, field, snapshotOf } from "./product-csv-test-support";

const ctx = context();

function fileOf(records = [boot(ctx)], dialect: DialectId = "standard", c = ctx) {
  return writeCsv(productFileRows(records, c), dialect);
}

describe("the columns", () => {
  it("are the contract's, in its order", () => {
    expect(productColumns(ctx)).toEqual([
      "handle", "status", "kind", "vat_category",
      "title", "description", "safety_information", "seo_title", "seo_description",
      "title:sv-SE", "description:sv-SE", "safety_information:sv-SE", "seo_title:sv-SE", "seo_description:sv-SE",
      "title:en-GB", "description:en-GB", "safety_information:en-GB", "seo_title:en-GB", "seo_description:en-GB",
      "categories", "tags",
      "option1_name", "option1_value", "option2_name", "option2_value", "option3_name", "option3_value",
      "variant_id", "sku", "gtin", "active", "delivery", "weight_grams", "hs_code", "origin_country", "cost", "stock",
      "measure_amount", "measure_unit", "measure_base", "price_basis",
      "price:NO", "price:SE",
      "image_url", "image_position", "image_alt", "variant_image_url",
      "field:material", "field:material:sv-SE", "field:material:en-GB", "field:weight_kg", "field:organic", "field:season",
      "variant_field:shade", "variant_field:shade:sv-SE", "variant_field:shade:en-GB",
    ]);
  });

  it("have no duplicate header, and a single-language store has no language columns", () => {
    const header = productColumns(ctx);
    expect(new Set(header).size).toBe(header.length);
    const one = productColumns(context({ locales: ["nb-NO"], fields: [] }));
    expect(one.filter((c) => c.includes(":") && !c.startsWith("price:"))).toEqual([]);
    expect(one.filter((c) => c.startsWith("price:"))).toEqual(["price:NO", "price:SE"]);
  });

  it("leaves out custom fields that do not fit in a cell, and names two fields share", () => {
    expect(addressableFields(ctx, "product").map((d) => d.name)).toEqual(["material", "weight_kg", "organic", "season"]);
    const twice = context({ fields: [{ def: field("a", "dup", "text"), entity: "product" }, { def: field("b", "dup", "number"), entity: "product" }, { def: FIELDS.shade, entity: "variant" }] });
    expect(ambiguousFieldNames(twice, "product")).toEqual(["dup"]);
    expect(addressableFields(twice, "product")).toEqual([]);
    expect(productColumns(twice).some((c) => c.startsWith("field:"))).toBe(false);
  });

  it("says the price basis the store enters prices in", () => {
    expect(priceBasisOf("consumers")).toBe("incl_vat");
    expect(priceBasisOf("both")).toBe("incl_vat");
    expect(priceBasisOf("businesses")).toBe("excl_vat");
  });
});

describe("a product as rows", () => {
  const rows = productRowsOf(boot(ctx), ctx);
  const header = productColumns(ctx);
  const cell = (r: number, name: string) => rows[r][header.indexOf(name)];

  it("has a row per variant, then a row for each picture they did not carry (3 variants, 4 pictures: 4 rows)", () => {
    expect(rows).toHaveLength(4);
    expect(rowCountOf(3, 4)).toBe(4);
    expect(rowCountOf(1, 1)).toBe(1);
    expect(rowCountOf(2, 5)).toBe(5);
    expect(rowCountOf(3, 1)).toBe(3);
    expect(cell(3, "sku")).toBeNull();
    expect(cell(3, "handle")).toBe("winter-boot");
    expect(cell(3, "image_url")).toBe("/demo/boot.svg");
    expect(cell(3, "image_position")).toBe(4);
  });

  it("puts the product's own cells on its first row only", () => {
    expect(cell(0, "title")).toBe("Vinterstøvel");
    expect(cell(1, "title")).toBeNull();
    expect(cell(0, "option1_name")).toBe("Colour");
    expect(cell(1, "option1_name")).toBeNull();
    expect(cell(1, "option1_value")).toBe("Black");
    expect(cell(0, "categories")).toBe("Shoes / Boots");
    expect(cell(0, "tags")).toBe("Winter | Sale");
    expect(cell(0, "status")).toBe("active");
    expect(cell(0, "title:sv-SE")).toBe("Vinterkänga");
    expect(cell(0, "description:en-GB")).toBe('Warm, with a "lining", and commas.');
  });

  it("writes every variant column: id, SKU, barcode, active, delivery, weight, HS code, origin, cost, stock, measure", () => {
    expect(rows.slice(0, 3).map((r) => r[header.indexOf("variant_id")])).toEqual(VARIANT_IDS);
    expect(cell(0, "sku")).toBe("BOOT-BLK-42");
    expect(cell(0, "gtin")).toBe("7041234567890");
    expect(cell(2, "active")).toBe("false");
    expect(cell(0, "delivery")).toBe("physical");
    expect(cell(0, "weight_grams")).toBe(1400);
    expect(cell(0, "hs_code")).toBe("640391");
    expect(cell(0, "origin_country")).toBe("PT");
    expect(cell(0, "cost")).toEqual({ num: "600.00" });
    expect(cell(0, "stock")).toBe(12);
    expect(cell(2, "measure_amount")).toEqual({ num: "0.75" });
    expect(cell(2, "measure_unit")).toBe("kg");
    expect(cell(2, "measure_base")).toBe("kg");
    expect(cell(1, "price_basis")).toBe("incl_vat");
  });

  it("writes each price as a number in the market's own currency, never converted, blank where there is none", () => {
    expect(cell(0, "price:NO")).toEqual({ num: "1249.00" });
    expect(cell(0, "price:SE")).toEqual({ num: "1299.50" });
    expect(cell(2, "price:NO")).toEqual({ num: "1299.00" });
    expect(cell(2, "price:SE")).toBeNull();
  });

  it("writes pictures with their position and alt text, a variant's own picture, and plain custom fields in their language", () => {
    expect(cell(0, "image_url")).toBe("https://store.example/p/1.webp");
    expect(cell(0, "image_position")).toBe(1);
    expect(cell(0, "image_alt")).toBe("Side view");
    expect(cell(1, "image_alt")).toBeNull();
    expect(cell(0, "variant_image_url")).toBe("https://store.example/p/1.webp");
    expect(cell(0, "field:material")).toBe("Skinn");
    expect(cell(0, "field:material:en-GB")).toBe("Leather");
    expect(cell(0, "field:material:sv-SE")).toBeNull();
    expect(cell(0, "field:weight_kg")).toEqual({ num: "1.4" });
    expect(cell(0, "field:organic")).toBe("true");
    expect(cell(0, "field:season")).toBe("winter");
    expect(cell(0, "variant_field:shade")).toBe("Mørk");
    expect(cell(1, "variant_field:shade")).toBeNull();
  });

  it("writes an archived product as archived, and sorts products by handle", () => {
    const archived = boot(ctx, { archived: true, status: "draft" });
    expect(productRowsOf(archived, ctx)[0][header.indexOf("status")]).toBe("archived");
    const b = boot(ctx, { handle: "b-product" });
    const a = boot(ctx, { handle: "a-product" });
    const all = productFileRows([b, a], ctx);
    expect(all[1][0]).toBe("a-product");
    expect(all[0]).toEqual(header);
  });
});

describe("terms as names", () => {
  it("writes a category as its path and reads it back, with tags as names", () => {
    expect(termPath(TERMS, C2)).toEqual(["Shoes", "Boots"]);
    expect(termPath(TERMS, C3)).toEqual(["Bags"]);
    expect(termPath(TERMS, "nope")).toBeNull();
    expect(parseTermList(`Shoes${CATEGORY_PATH_SEPARATOR}Boots | Bags`, "category")).toEqual([["Shoes", "Boots"], ["Bags"]]);
    expect(parseTermList("Winter |  | Sale ", "tag")).toEqual([["Winter"], ["Sale"]]);
    expect(parseTermList("", "tag")).toEqual([]);
  });
});

describe("reading", () => {
  const parsed = () => parseCsv(fileOf());

  it("reads a file into neutral rows numbered as a spreadsheet does (the header is row 1)", () => {
    const file = readNeutral(parsed().rows, ctx);
    expect(file.format).toBe("kaizen");
    expect(file.rows.map((r) => r.row)).toEqual([2, 3, 4, 5]);
    expect(file.columns.has("price:NO")).toBe(true);
    expect(file.ignored).toEqual([]);
  });

  it("ignores a column Kaizen does not have, with a reason, and keeps one a language or a field makes", () => {
    const rows = [["handle", "title", "color", "title:sv-SE", "field:anything", "price:DK"], ["a", "A", "red", "Å", "x", "5"]];
    const file = readNeutral(rows, ctx);
    expect(file.ignored).toEqual([{ column: "color", reason: "Kaizen does not have this column" }]);
    expect([...file.columns].sort()).toEqual(["field:anything", "handle", "price:DK", "title", "title:sv-SE"]);
  });

  it("groups rows by handle, takes the first row's product cells, collects variants and pictures by position", () => {
    const grouped = groupProducts(readNeutral(parsed().rows, ctx));
    expect(grouped.findings).toEqual([]);
    expect(grouped.drafts).toHaveLength(1);
    const d = grouped.drafts[0];
    expect(d.rows).toEqual([2, 3, 4, 5]);
    expect(d.variants).toHaveLength(3);
    expect(d.pictures.map((p) => p.url)).toEqual(["https://store.example/p/1.webp", "https://store.example/p/2.webp", "https://store.example/p/3.webp", "/demo/boot.svg"]);
    expect(optionNamesOf(d)).toEqual([{ pos: 1, name: "Colour" }, { pos: 2, name: "Size" }]);
    expect(isVariantRow(d.variants[0].v)).toBe(true);
  });

  it("orders pictures by position, and keeps their order where none is given", () => {
    const p = (url: string, position: number | null) => ({ row: 1, url, position, alt: "" });
    expect(orderedPictures([p("b", 2), p("a", 1), p("c", 3)]).map((x) => x.url)).toEqual(["a", "b", "c"]);
    expect(orderedPictures([p("x", null), p("y", null)]).map((x) => x.url)).toEqual(["x", "y"]);
  });

  it("finds a row with no handle, and a handle that comes back after another", () => {
    const rows = [["handle", "title", "sku"], ["a", "A", "S1"], ["b", "B", "S2"], ["a", "A again", "S3"], ["", "x", "S4"]];
    const grouped = groupProducts(readNeutral(rows, ctx));
    expect(grouped.drafts.map((d) => d.handle)).toEqual(["a", "b"]);
    expect(grouped.findings.map((f) => [f.rows, f.finding.code])).toEqual([[[4], "handle.duplicate_in_file"], [[5], "row.handle_missing"]]);
  });

  it("treats a row with only a handle and a picture as a picture of the product above, not a variant", () => {
    const rows = [["handle", "title", "sku", "image_url"], ["a", "A", "S1", "https://x/1.jpg"], ["a", "", "", "https://x/2.jpg"]];
    const d = groupProducts(readNeutral(rows, ctx)).drafts[0];
    expect(d.variants).toHaveLength(1);
    expect(d.pictures).toHaveLength(2);
  });
});

describe("a round trip changes nothing", () => {
  for (const dialect of ["standard", "excel_nordic"] as const) {
    it(`exports then imports every product as unchanged, with no write (${dialect})`, () => {
      const stored = [boot(ctx), boot(ctx, { handle: "second", id: "pppppppp-0000-4000-8000-000000000002", variants: [{ ...boot(ctx).variants[0], id: "aaaaaaaa-0000-4000-8000-000000000009", sku: "SECOND-1", options: { Colour: "Black", Size: "42" } }], fieldData: undefined, media: [], status: "draft", categories: [], tags: [], options: [{ name: "Colour", values: ["Black"] }, { name: "Size", values: ["42"] }] })];
      const csv = fileOf(stored, dialect);
      const file = readNeutral(parseCsv(csv).rows, ctx);
      const plan = planImport(file, snapshotOf(stored), env(ctx));
      expect(plan.fileFindings).toEqual([]);
      expect(plan.products.map((p) => [p.handle, p.outcome, p.input, p.findings])).toEqual([
        ["second", "unchanged", null, []],
        ["winter-boot", "unchanged", null, []],
      ]);
      expect(plan.dry).toEqual({ toCreate: 0, toUpdate: 0, unchanged: 2, withProblems: 0 });
    });
  }

  it("holds for an archived product and a store selling only to businesses", () => {
    const b2b = context({ audience: "businesses" });
    const stored = boot(b2b, { archived: true, status: "draft" });
    const csv = fileOf([stored], "standard", b2b);
    const plan = planImport(readNeutral(parseCsv(csv).rows, b2b), snapshotOf([stored]), env(b2b));
    expect(plan.products[0].outcome).toBe("unchanged");
    expect(parseCsv(csv).rows[1][productColumns(b2b).indexOf("price_basis")]).toBe("excl_vat");
  });

  it("holds when the product has a text that looks like a formula, a quote, a comma and a newline in every text it holds (the injection canary)", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      const s = (x: string) => `${lead}${x}`;
      const base = boot(ctx);
      const hostile = boot(ctx, {
        translations: base.translations.map((t) => ({ ...t, title: s(`T ${t.locale}`), description: s("D, \"q\"\nline"), safetyInformation: s("S"), seoTitle: s("ST"), seoDescription: s("SD") })),
        media: base.media.map((m, i) => ({ ...m, alt: s(`alt${i}`) })),
        options: [{ name: s("Colour"), values: [s("Black"), s("Brown")] }, { name: s("Size"), values: [s("42"), s("43")] }],
        variants: base.variants.map((v) => ({ ...v, sku: s(v.sku), options: { [s("Colour")]: s(v.options.Colour), [s("Size")]: s(v.options.Size) } })),
        fieldData: { product: { values: {}, translations: { "nb-NO": { f_material: s("Skinn") } } }, variants: { [VARIANT_IDS[0]]: { values: {}, translations: { "nb-NO": { f_shade: s("Mørk") } } } } },
      });
      const terms = [...TERMS, { id: C9, kind: "tag" as const, parentId: null, name: s("tag"), slug: "t" }];
      const c = context({ terms });
      hostile.tags = [C9];
      const csv = writeCsv(productFileRows([hostile], c));
      // No cell of the file starts with a formula character, whatever the store holds.
      for (const row of parseCsv(csv).rows.slice(1)) {
        for (const text of row) expect([lead, text, /^[=+\-@\t\r\n]/.test(text)]).toEqual([lead, text, false]);
      }
      const plan = planImport(readNeutral(parseCsv(csv).rows, c), snapshotOf([hostile]), env(c));
      expect([lead, plan.products[0].findings.map((f) => f.code), plan.products[0].outcome]).toEqual([lead, [], "unchanged"]);
    }
  });
});
