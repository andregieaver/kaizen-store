import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { changesFrom, emptyGroup, type FieldData, type FieldDef } from "@/lib/custom-fields";
import { newBlock } from "@/lib/page-rows";
import type { ContentGridBlock } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { saveContentType, getContentType, designEntryLayout, typeOfLayout } = await import("./content-types");
const { saveEntry, publishEntry, deleteEntry, getEntry } = await import("./content-entries");
const { gridEntries, findEntryPage, listIndexedEntries } = await import("./content-site");
const { gridData } = await import("./content-grid");
const fields = await import("./custom-fields");
const { resolveMiss } = await import("./redirect-resolve");
const { liveOf } = await import("./redirect-live");
const { newStore } = await import("./inventory-test-support");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * Entries on the site (wave 6 unit H2, D326): an entry field holding the owner's own entries of its type only and drawn as a link to the
 * entry's page while it is published, every reference cleared when an entry is deleted, a content grid of a type's published entries, an
 * entry's own page and the sitemap's list, a redirect left by a published entry's new address, and a type's entry layout.
 */

const title: FieldDef = { id: "f_ptitle00001", name: "name", label: "Name", type: "text", access: "public", width: 100 };
const role: FieldDef = { id: "f_prole000001", name: "role", label: "Role", type: "text", access: "public", width: 100 };
const secret: FieldDef = { id: "f_psecret0001", name: "secret", label: "Secret", type: "text", access: "private", width: 100 };
const locales = ["nb-NO", "en"];

let a: Awaited<ReturnType<typeof newStore>>;
let b: Awaited<ReturnType<typeof newStore>>;
let market = "no";
let teamKey = "";
let teamId = "";
let kari = "";
let ola = "";
let draftOnly = "";
let otherStoreEntry = "";
let productId = "";
const pick: FieldDef = { id: "f_pick0000001", name: "people", label: "People", type: "entry", access: "public", width: 100, multiple: true };

const actor = () => ({ accountId: a.accountId, owner: a.storeId });
const ctx = () => ({ ...actor(), locales, main: "nb-NO", currencies: ["NOK"] });
const words = (values: Record<string, unknown>): FieldData => ({ values: {}, translations: { "nb-NO": values as Record<string, string> } });

async function entryOf(owner: string, typeId: string, slug: string, values: Record<string, unknown>, publish = true) {
  const context = { accountId: owner === a.storeId ? a.accountId : b.accountId, owner, locales, main: "nb-NO", currencies: ["NOK"] };
  const type = (await getContentType(owner, typeId))!;
  const saved = await saveEntry(context, { typeId, slug, fields: changesFrom(type.fields, words(values), locales) });
  expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  if (publish) expect(await publishEntry(context, saved.id!)).toMatchObject({ ok: true });
  return saved.id!;
}

beforeAll(async () => {
  a = await newStore("entries-a");
  b = await newStore("entries-b");
  market = (await getStore(a.slug))!.markets[0].slug;
  const saved = await saveContentType(actor(), { name: "Team", slug: "team", fields: [title, role, secret], titleField: title.id, summaryField: role.id, pictureField: null, hasPages: true });
  teamId = saved.id!;
  teamKey = (await getContentType(a.storeId, teamId))!.key;
  kari = await entryOf(a.storeId, teamId, "kari", { [title.id]: "Kari", [role.id]: "Baker", [secret.id]: "hidden" });
  ola = await entryOf(a.storeId, teamId, "ola", { [title.id]: "Ola", [role.id]: "Driver" });
  draftOnly = await entryOf(a.storeId, teamId, "utkast", { [title.id]: "Utkast" }, false);
  const theirs = await saveContentType({ accountId: b.accountId, owner: b.storeId }, { name: "Team", slug: "team", fields: [title], titleField: title.id, summaryField: null, pictureField: null, hasPages: true });
  otherStoreEntry = await entryOf(b.storeId, theirs.id!, "per", { [title.id]: "Per" });
  const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${a.storeId}::uuid and status = 'active' order by handle limit 1`);
  productId = String(product.id);
});

afterAll(async () => {
  await closeDb();
});

describe("an entry field (D326)", () => {
  it("keeps only the owner's own entries of its type, and draws them as links to their pages while published", async () => {
    const group = await fields.saveFieldGroup(a.member, { ...emptyGroup("product"), name: "Who", slug: "who", fields: [{ ...pick, contentType: teamKey }] });
    expect(group, JSON.stringify(group)).toMatchObject({ ok: true });
    const facts = (await fields.productFacts(db(), a.storeId, productId))!;
    await db().transaction((tx) =>
      fields.saveFieldData(tx, a.storeId, "product", productId, { values: { [pick.id]: [kari, otherStoreEntry, draftOnly] }, translations: {} }, { facts, locales, main: "nb-NO", requireAll: false }),
    );
    const kept = await fields.getFieldData(a.storeId, "product", productId);
    // Another store's entry is never kept; a draft of the store's own is (it shows once published).
    expect(kept.values[pick.id]).toEqual([kari, draftOnly]);
    const shown = await fields.shownFieldsFor(a.storeId, "product", productId, "nb-NO", "nb", market);
    const field = shown.flatMap((g) => g.fields).find((f) => f.id === pick.id)!;
    expect(field.links?.map((l) => l.label)).toEqual(["Kari"]);
    expect(field.links?.[0].href).toMatch(/\/team\/kari$/);
  });

  it("refuses an entry field that names no content type", async () => {
    const result = await fields.saveFieldGroup(a.member, { ...emptyGroup("product"), name: "Bad", slug: "bad", fields: [pick] });
    expect(result.ok).toBe(false);
  });

  it("loses a deleted entry everywhere it was named: other entries and field values", async () => {
    // Ola names Kari in a field the type gets now.
    const withPick = await saveContentType(actor(), { id: teamId, name: "Team", slug: "team", fields: [title, role, secret, { ...pick, contentType: teamKey }], titleField: title.id, summaryField: role.id, pictureField: null, hasPages: true });
    expect(withPick, JSON.stringify(withPick)).toMatchObject({ ok: true });
    expect(await saveEntry(ctx(), { id: ola, typeId: teamId, slug: "ola", fields: { values: { [pick.id]: [kari] }, translations: {} } })).toMatchObject({ ok: true });
    expect(await publishEntry(ctx(), ola)).toMatchObject({ ok: true });
    expect((await getEntry(a.storeId, ola))!.published?.data.values[pick.id]).toEqual([kari]);

    expect(await deleteEntry(actor(), draftOnly)).toMatchObject({ ok: true });
    expect((await fields.getFieldData(a.storeId, "product", productId)).values[pick.id]).toEqual([kari]);
    expect(await deleteEntry(actor(), kari)).toMatchObject({ ok: true });
    const olaNow = (await getEntry(a.storeId, ola))!;
    expect(olaNow.draft.data.values).not.toHaveProperty(pick.id);
    expect(olaNow.published?.data.values).not.toHaveProperty(pick.id);
    expect(olaNow.draft.data.translations["nb-NO"][title.id]).toBe("Ola");
    expect(await fields.getFieldData(a.storeId, "product", productId)).toMatchObject({ values: {} });
    kari = await entryOf(a.storeId, teamId, "kari", { [title.id]: "Kari", [role.id]: "Baker" });
  });
});

describe("a grid of a type's entries", () => {
  it("lists the published entries in the owner's order, linked to their pages, with their summary and public tile lines", async () => {
    const grid = await gridEntries(a.storeId, market, teamKey, { sort: "title", limit: 12, tileFields: [role.id, secret.id] });
    expect(grid.items.map((i) => i.title)).toEqual(["Kari", "Ola"]);
    const kariTile = grid.items[0];
    expect(kariTile.href).toMatch(/\/team\/kari$/);
    expect(kariTile.excerpt).toBe("Baker");
    // A private field is never on a tile.
    expect(kariTile.fields).toEqual([{ label: "Role", text: "Baker" }]);
    // Another store, or another store's key, shows nothing of it.
    expect((await gridEntries(b.storeId, null, teamKey, { sort: "newest", limit: 12, tileFields: [] })).items).toEqual([]);
  });

  it("is answered by gridData() for a content grid whose source is the type", async () => {
    const block = { ...(newBlock("contentGrid", () => "g1") as ContentGridBlock), source: { type: "entries" as const, contentType: teamKey }, sort: "oldest" as const, limit: 1 };
    const grid = await gridData(block, { pageId: null, owner: a.storeId, market });
    expect(grid.items).toHaveLength(1);
  });
});

describe("an entry's own page", () => {
  it("is found at /{type}/{entry} while published, and listed for the sitemap", async () => {
    const found = await findEntryPage(a.storeId, "team", "ola");
    expect(found?.entry.id).toBe(ola);
    expect(found?.layout).toBeNull();
    expect(await findEntryPage(a.storeId, "team", "nobody")).toBeNull();
    expect(await findEntryPage(b.storeId, "team", "ola")).toBeNull();
    expect((await listIndexedEntries(a.storeId)).map((e) => e.path).sort()).toEqual(["team/kari", "team/ola"]);
    expect([...(await liveOf(a.storeId, ["/team/ola", "/team/nobody"]))]).toEqual(["/team/ola"]);
  });

  it("leaves a redirect when a published entry's address changes, which leads to its new one", async () => {
    expect(await saveEntry(ctx(), { id: ola, typeId: teamId, slug: "ola-nordmann", fields: {} })).toMatchObject({ ok: true });
    const [row] = await db().execute<Row>(sql`select kind, entry_id from commerce.redirects where store_id = ${a.storeId}::uuid and source = '/team/ola'`);
    expect(row).toMatchObject({ kind: "entry", entry_id: ola });
    expect(await resolveMiss(a.storeId, null, "/team/ola")).toMatchObject({ to: "/team/ola-nordmann" });
    // An entry that takes the old address back takes the redirect away.
    expect(await saveEntry(ctx(), { id: ola, typeId: teamId, slug: "ola", fields: {} })).toMatchObject({ ok: true });
    expect(await db().execute<Row>(sql`select 1 from commerce.redirects where store_id = ${a.storeId}::uuid and source = '/team/ola'`)).toHaveLength(0);
  });

  it("is drawn by the type's entry layout, made once and of the type's own owner", async () => {
    const made = await designEntryLayout(a.member.account, a.storeId, teamId);
    expect(made, JSON.stringify(made)).toMatchObject({ ok: true });
    expect((await getContentType(a.storeId, teamId))!.layoutId).toBe(made.id);
    expect(await designEntryLayout(a.member.account, a.storeId, teamId)).toEqual({ ok: true, id: made.id });
    expect((await typeOfLayout(a.storeId, made.id!))?.id).toBe(teamId);
    const [layout] = await db().execute<Row>(sql`select type, draft from commerce.pages where id = ${made.id!}::uuid`);
    expect(layout.type).toBe("entry_layout");
    // Not published yet: entries keep the standard page.
    expect((await findEntryPage(a.storeId, "team", "ola"))?.layout).toBeNull();
    await db().execute(sql`update commerce.pages set published = draft, published_at = now() where id = ${made.id!}::uuid`);
    expect((await findEntryPage(a.storeId, "team", "ola"))?.layout?.rows).toHaveLength(1);
    // The database refuses a layout that is another owner's or not an entry layout.
    const [page] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${b.storeId}::uuid limit 1`);
    await expect(db().execute(sql`update commerce.content_types set layout_id = ${String(page.id)}::uuid where id = ${teamId}::uuid`)).rejects.toThrow();
  });
});
