// Writes the standard product taxonomy the app reads (wave 6 unit I, D327, docs/wave-6-catalogue.md Unit I) from a release of Shopify's open
// Standard Product Taxonomy, https://github.com/Shopify/product-taxonomy (MIT licence, read 2026-10-27: "Permission is hereby granted, free of
// charge, to any person obtaining a copy … to deal in the Software without restriction", with the copyright notice kept, which
// src/data/product-taxonomy/LICENSE is). A developer tool, run once per release and never imported by the app; no service is called at run time.
//
// Check out a release tag (v2026-10 was commit 2ea72664) with the languages wanted under dist/, then:
//
//   node scripts/product-taxonomy.mjs <the release's dist folder> <tag> <commit> en nb sv da
//
// It writes src/data/product-taxonomy/structure.json (categories with their Google id and attributes, attributes with their values' ids and
// handles) and names-{lang}.json (every name in that language), sorted, so the same release gives the same bytes. Ids are Shopify's own (a
// category's `aa-1-1`, an attribute's and a value's number), which stay the same across releases: a release that retires or moves one is a
// migration mapping products' ids with the release's integrations/shopify mapping, beside the new files.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [dist, tag, commit, ...langs] = process.argv.slice(2);
if (!dist || !tag || !commit || langs.length === 0 || !langs.includes("en")) {
  console.error("usage: node scripts/product-taxonomy.mjs <dist folder> <tag> <commit> en nb sv da");
  process.exit(1);
}
const OUT = path.join(process.cwd(), "src/data/product-taxonomy");

const json = async (lang, file) => JSON.parse(await readFile(path.join(dist, lang, file), "utf8"));
const catId = (gid) => gid.replace("gid://shopify/TaxonomyCategory/", "");
const num = (gid) => Number(gid.slice(gid.lastIndexOf("/") + 1));
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byNum = (a, b) => Number(a) - Number(b);

/** One entry a line, keys sorted: a release's change reads as a diff. */
function lines(object, order = byKey) {
  const keys = Object.keys(object).sort(order);
  return `{\n${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(object[k])}`).join(",\n")}\n}`;
}

const enCategories = await json("en", "categories.json");
const enAttributes = (await json("en", "attributes.json")).attributes;
const mappings = (await json("en", "integrations/all_mappings.json")).mappings;
const google = mappings.find((m) => m.output_taxonomy.startsWith("google/"));
if (!google) throw new Error("no mapping to Google's taxonomy in this release");

const googleOf = new Map();
for (const rule of google.rules) {
  const out = rule.output.category ?? [];
  if (out.length > 0) googleOf.set(catId(rule.input.category.id), Number(out[0].id));
}

// Categories: [Google's id or 0, attribute ids, { attribute id: the extended name's handle } where the category names it its own way].
const categories = {};
for (const vertical of enCategories.verticals) {
  for (const c of vertical.categories) {
    const attrs = [];
    const named = {};
    for (const a of c.attributes) {
      const id = num(a.id);
      if (!attrs.includes(id)) attrs.push(id);
      if (a.extended) named[id] = a.handle;
    }
    attrs.sort((x, y) => x - y);
    categories[catId(c.id)] = Object.keys(named).length > 0 ? [googleOf.get(catId(c.id)) ?? 0, attrs, named] : [googleOf.get(catId(c.id)) ?? 0, attrs];
  }
}

// Attributes: [handle, value ids]; values: the part of their handle after the attribute's (`color__blue` is `blue`).
const attributes = {};
const values = {};
for (const a of enAttributes) {
  const ids = a.values.map((v) => num(v.id));
  attributes[num(a.id)] = [a.handle, ids];
  for (const v of a.values) {
    const handle = v.handle.startsWith(`${a.handle}__`) ? v.handle.slice(a.handle.length + 2) : v.handle;
    values[num(v.id)] = handle;
  }
}

await mkdir(OUT, { recursive: true });
const structure =
  `{"release":${JSON.stringify(tag)},"commit":${JSON.stringify(commit)},"label":${JSON.stringify(enCategories.version)},` +
  `"google":${JSON.stringify(google.output_taxonomy.replace("google/", ""))},\n` +
  `"categories":${lines(categories)},\n"attributes":${lines(attributes, byNum)},\n"values":${lines(values, byNum)}}\n`;
await writeFile(path.join(OUT, "structure.json"), structure);

for (const lang of langs) {
  const cats = await json(lang, "categories.json");
  const attrs = (await json(lang, "attributes.json")).attributes;
  const c = {};
  const x = {};
  for (const vertical of cats.verticals) {
    for (const cat of vertical.categories) {
      c[catId(cat.id)] = cat.name;
      for (const a of cat.attributes) if (a.extended) x[a.handle] = a.name;
    }
  }
  const a = {};
  const v = {};
  for (const attr of attrs) {
    a[num(attr.id)] = attr.name;
    for (const value of attr.values) v[num(value.id)] = value.name;
  }
  const text = `{"c":${lines(c)},\n"a":${lines(a, byNum)},\n"x":${lines(x)},\n"v":${lines(v, byNum)}}\n`;
  await writeFile(path.join(OUT, `names-${lang}.json`), text);
}
console.log(`wrote ${Object.keys(categories).length} categories, ${Object.keys(attributes).length} attributes, ${Object.keys(values).length} values, ${langs.length} languages`);
