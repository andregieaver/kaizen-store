import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import { changesFrom, type FieldData, type FieldDef } from "@/lib/custom-fields";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { saveContentType, getContentType, deleteContentType } = await import("./content-types");
const { saveEntry, publishEntry } = await import("./content-entries");
const { gridEntries, findEntryPage, listIndexedEntries } = await import("./content-site");
const { shownPlatformEntryFields } = await import("./custom-fields");
const { newStore } = await import("./inventory-test-support");

/**
 * Kaizena Flow's own content (wave 6 unit H4, D326): a type with no owner, its entries on its own site's addresses in English and Norwegian
 * (English where a text has no Norwegian), listed by a grid and in the sitemap; no money or file field, and never a reserved address.
 */

const suffix = Date.now().toString(36);
const slug = `cases-${suffix}`;
const name: FieldDef = { id: "f_kname000001", name: "name", label: "Name", type: "text", access: "public", width: 100 };
const about: FieldDef = { id: "f_kabout00001", name: "about", label: "About", type: "text", access: "public", width: 100 };
const note: FieldDef = { id: "f_knote000001", name: "note", label: "Note", type: "text", access: "private", width: 100 };
const locales = ["en", "nb-NO"];

let accountId = "";
let typeId = "";
let key = "";

const actor = () => ({ accountId, owner: null });
const ctx = () => ({ ...actor(), locales, main: "en", currencies: [] as string[] });

beforeAll(async () => {
  accountId = (await newStore("content-platform")).accountId;
  const saved = await saveContentType(actor(), { name: "Cases", slug, fields: [name, about, note], titleField: name.id, summaryField: about.id, pictureField: null, hasPages: true });
  expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  typeId = saved.id!;
  key = (await getContentType(null, typeId))!.key;
  const data: FieldData = {
    values: {},
    translations: { en: { [name.id]: "Bakery", [about.id]: "A bakery in Oslo", [note.id]: "internal" }, "nb-NO": { [about.id]: "Et bakeri i Oslo" } },
  };
  const entry = await saveEntry(ctx(), { typeId, slug: "bakery", fields: changesFrom([name, about, note], data, locales) });
  expect(entry, JSON.stringify(entry)).toMatchObject({ ok: true });
  expect(await publishEntry(ctx(), entry.id!)).toMatchObject({ ok: true });
});

afterAll(async () => {
  if (typeId) await deleteContentType(actor(), typeId);
  await closeDb();
});

describe("Kaizena Flow's own content (D326 H4)", () => {
  it("serves an entry at its own site's address, in Norwegian where it has words, English otherwise", async () => {
    const found = (await findEntryPage(null, slug, "bakery"))!;
    expect(found.entry.slug).toBe("bakery");
    const en = (await shownPlatformEntryFields(found.entry.id, "en")).flatMap((g) => g.fields).map((f) => [f.label, f.text]);
    expect(en).toEqual([["Name", "Bakery"], ["About", "A bakery in Oslo"]]);
    const nb = (await shownPlatformEntryFields(found.entry.id, "nb")).flatMap((g) => g.fields).map((f) => [f.label, f.text]);
    expect(nb).toEqual([["Name", "Bakery"], ["About", "Et bakeri i Oslo"]]);
  });

  it("lists it by a grid linking to its page, and in the sitemap", async () => {
    const en = await gridEntries(null, null, key, { sort: "newest", limit: 12, tileFields: [] }, "en");
    expect(en.items.map((item) => [item.title, item.href])).toEqual([["Bakery", `/${slug}/bakery`]]);
    const nb = await gridEntries(null, null, key, { sort: "newest", limit: 12, tileFields: [] }, "nb");
    expect(nb.items.map((item) => item.href)).toEqual([`/no/${slug}/bakery`]);
    expect((await listIndexedEntries(null)).map((e) => e.path)).toContain(`${slug}/bakery`);
  });

  it("refuses money and file fields, and a reserved address", async () => {
    const money: FieldDef = { id: "f_kmoney00001", name: "price", label: "Price", type: "money", access: "public", width: 100 };
    const file: FieldDef = { id: "f_kfile000001", name: "sheet", label: "Sheet", type: "file", access: "public", width: 100 };
    for (const extra of [money, file]) {
      const result = await saveContentType(actor(), { name: "Refused", slug: `refused-${suffix}`, fields: [name, extra], titleField: name.id, summaryField: null, pictureField: null, hasPages: false });
      expect(result).toMatchObject({ ok: false });
    }
    const reserved = await saveContentType(actor(), { name: "Themes", slug: "themes", fields: [name], titleField: name.id, summaryField: null, pictureField: null, hasPages: true });
    expect(reserved).toMatchObject({ ok: false });
  });
});
