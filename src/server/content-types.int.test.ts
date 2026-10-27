import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { changesFrom, type FieldData, type FieldDef } from "@/lib/custom-fields";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { saveContentType, getContentType, listContentTypes, deleteContentType, contentTypeByKey } = await import("./content-types");
const { saveEntry, publishEntry, unpublishEntry, getEntry, listEntries, deleteEntry, moveEntry, freeSlug } = await import("./content-entries");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * Content types (wave 6 unit H1, D326): a type and its entries written only through their modules, store-scoped (one store cannot read,
 * write or reach another's), a removed field's values taken out of every entry, a field's type and a published type's web name fixed,
 * publishing asking for a title and the required fields, and the copies (`clone_store()`, `duplicate_store()`) carrying both with every
 * reference to an entry made the copy's.
 */

const title: FieldDef = { id: "f_title000001", name: "title", label: "Title", type: "text", access: "public", width: 100 };
const role: FieldDef = { id: "f_role0000001", name: "role", label: "Role", type: "text", access: "public", width: 100, required: true };
const note: FieldDef = { id: "f_note0000001", name: "note", label: "Note", type: "textarea", access: "private", width: 100 };
const fields = [title, role, note];

let a: Awaited<ReturnType<typeof newStore>>;
let b: Awaited<ReturnType<typeof newStore>>;
const actorA = () => ({ accountId: a.accountId, owner: a.storeId });
const ctxA = () => ({ ...actorA(), locales: ["nb-NO", "en"], main: "nb-NO", currencies: ["NOK"] });
const typeInput = (extra: Record<string, unknown> = {}) => ({
  name: "Team",
  slug: "team",
  fields,
  titleField: title.id,
  summaryField: note.id,
  pictureField: null,
  hasPages: true,
  ...extra,
});
const words = (values: Record<string, string>, locale = "nb-NO"): FieldData => ({ values: {}, translations: { [locale]: values } });

beforeAll(async () => {
  a = await newStore("content-a");
  b = await newStore("content-b");
});

afterAll(async () => {
  await closeDb();
});

describe("content types (D326)", () => {
  let typeId: string;
  let entryId: string;

  it("keeps a type with a fixed key, its owner's only", async () => {
    const saved = await saveContentType(actorA(), typeInput());
    expect(saved).toMatchObject({ ok: true });
    typeId = saved.id!;
    const type = (await getContentType(a.storeId, typeId))!;
    expect(type.key).toMatch(/^t_[0-9a-f]{12}$/);
    expect(await contentTypeByKey(a.storeId, type.key)).toMatchObject({ id: typeId });
    // Another store, and Kaizena Flow's own site, see nothing of it.
    expect(await getContentType(b.storeId, typeId)).toBeNull();
    expect(await getContentType(null, typeId)).toBeNull();
    expect(await listContentTypes(b.storeId)).toEqual([]);
    // The same web name is refused in the same store, not in another.
    expect(await saveContentType(actorA(), typeInput())).toMatchObject({ ok: false, problems: [expect.stringContaining("web name team")] });
    expect(await saveContentType({ accountId: b.accountId, owner: b.storeId }, typeInput())).toMatchObject({ ok: true });
  });

  it("saves an entry's draft through the fields' own checks, and publishes it only with a title and its required fields", async () => {
    const saved = await saveEntry(ctxA(), { typeId, slug: "kari", fields: changesFrom(fields, words({ [title.id]: "Kari" }), ["nb-NO", "en"]) });
    expect(saved).toMatchObject({ ok: true });
    entryId = saved.id!;
    expect((await getEntry(a.storeId, entryId))!.published).toBeNull();
    // Role is required: publishing waits for it.
    expect(await publishEntry(ctxA(), entryId)).toMatchObject({ ok: false, problems: ["Role is required."] });
    const filled = words({ [title.id]: "Kari", [role.id]: "Baker", [note.id]: "Private" });
    expect(await saveEntry(ctxA(), { id: entryId, typeId, slug: "kari", fields: changesFrom(fields, filled, ["nb-NO", "en"]) })).toMatchObject({ ok: true });
    expect(await publishEntry(ctxA(), entryId)).toMatchObject({ ok: true });
    const entry = (await getEntry(a.storeId, entryId))!;
    expect(entry.published?.data.translations["nb-NO"][title.id]).toBe("Kari");
    expect(entry.firstPublishedAt).not.toBeNull();
    // A value of the wrong shape is refused as a field's own check says.
    const wrong = await saveEntry(ctxA(), { id: entryId, typeId, slug: "kari", fields: { values: {}, translations: { "nb-NO": { [title.id]: 42 } } } });
    expect(wrong.ok).toBe(false);
    // Unpublished, it keeps its draft.
    expect(await unpublishEntry(actorA(), entryId)).toMatchObject({ ok: true });
    expect((await getEntry(a.storeId, entryId))!.published).toBeNull();
    expect(await publishEntry(ctxA(), entryId)).toMatchObject({ ok: true });
  });

  it("never lets another store read, change, publish or delete an entry, or write one into a type of another store", async () => {
    const actorB = { accountId: b.accountId, owner: b.storeId };
    const ctxB = { ...actorB, locales: ["nb-NO"], main: "nb-NO", currencies: ["NOK"] };
    expect(await getEntry(b.storeId, entryId)).toBeNull();
    expect(await listEntries(b.storeId, typeId)).toEqual([]);
    expect(await saveEntry(ctxB, { typeId, slug: "x", fields: {} })).toMatchObject({ ok: false });
    expect(await saveEntry(ctxB, { id: entryId, typeId, slug: "x", fields: {} })).toMatchObject({ ok: false });
    expect(await publishEntry(ctxB, entryId)).toMatchObject({ ok: false });
    expect(await unpublishEntry(actorB, entryId)).toMatchObject({ ok: false });
    expect(await deleteEntry(actorB, entryId)).toMatchObject({ ok: false });
    expect(await deleteContentType(actorB, typeId)).toMatchObject({ ok: false });
    expect(await getEntry(a.storeId, entryId)).not.toBeNull();
    // The database refuses an entry whose owner is not its type's.
    await expect(
      db().execute(sql`insert into commerce.content_entries (store_id, type_id, slug, draft) values (${b.storeId}::uuid, ${typeId}::uuid, 'sneak', '{}'::jsonb)`),
    ).rejects.toThrow();
  });

  it("gives a new entry a free address, and keeps the owner's order", async () => {
    const first = await saveEntry(ctxA(), { typeId, slug: "kari", fields: {} });
    expect(first.ok).toBe(true);
    expect((await getEntry(a.storeId, first.id!))!.slug).toBe("kari-2");
    expect(freeSlug("kari", new Set(["kari", "kari-2"]))).toBe("kari-3");
    expect(await saveEntry(ctxA(), { id: first.id, typeId, slug: "kari", fields: {} })).toMatchObject({ ok: false });
    expect((await listEntries(a.storeId, typeId)).map((e) => e.id)).toEqual([entryId, first.id]);
    await moveEntry(actorA(), first.id!, "earlier");
    expect((await listEntries(a.storeId, typeId)).map((e) => e.id)).toEqual([first.id, entryId]);
    expect(await deleteEntry(actorA(), first.id!)).toMatchObject({ ok: true });
  });

  it("refuses a field's new type and a published type's new web name, and takes a removed field's values out of every entry", async () => {
    expect(await saveContentType(actorA(), typeInput({ id: typeId, fields: [title, role, { ...note, type: "text" }] }))).toMatchObject({ ok: false });
    expect(await saveContentType(actorA(), typeInput({ id: typeId, slug: "people" }))).toMatchObject({ ok: false, problems: [expect.stringContaining("fixed")] });
    expect(await saveContentType(actorA(), typeInput({ id: typeId, fields: [title, role], summaryField: null }))).toMatchObject({ ok: true });
    const entry = (await getEntry(a.storeId, entryId))!;
    expect(entry.draft.data.translations["nb-NO"]).not.toHaveProperty(note.id);
    expect(entry.published?.data.translations["nb-NO"]).not.toHaveProperty(note.id);
    expect(entry.draft.data.translations["nb-NO"][role.id]).toBe("Baker");
  });

  it("go with the store when it is copied, references to entries made the copy's", async () => {
    // A second entry naming the first by id, as a reference field will (H2).
    const other = await saveEntry(ctxA(), { typeId, slug: "ola", fields: {} });
    await db().execute(sql`
      update commerce.content_entries set draft = jsonb_set(draft, '{data,values,f_ref000000001}', ${JSON.stringify([entryId])}::jsonb)
      where id = ${other.id!}::uuid
    `);
    const [made] = await db().execute<Row>(sql`
      select commerce.duplicate_store(${a.storeId}::uuid, ${`${a.slug}-copy`}, 'Copy', ${a.accountId}::uuid, null, null, null) as id
    `);
    const copy = String(made.id);
    const types = await listContentTypes(copy);
    expect(types.map((t) => [t.slug, t.key])).toEqual([["team", (await getContentType(a.storeId, typeId))!.key]]);
    const entries = await listEntries(copy, types[0].id);
    expect(entries.map((e) => e.slug).sort()).toEqual(["kari", "ola"]);
    const kari = entries.find((e) => e.slug === "kari")!;
    const ola = entries.find((e) => e.slug === "ola")!;
    expect(kari.id).not.toBe(entryId);
    expect(kari.published).not.toBeNull();
    expect(ola.draft.data.values.f_ref000000001).toEqual([kari.id]);

    // A store made from this one as a template (clone_store()) does the same.
    const [cloned] = await db().execute<Row>(sql`select commerce.clone_store(${a.storeId}::uuid, ${`${a.slug}-clone`}, 'Clone', ${a.accountId}::uuid) as id`);
    const clone = String(cloned.id);
    const cloneTypes = await listContentTypes(clone);
    const cloneEntries = await listEntries(clone, cloneTypes[0].id);
    const cloneKari = cloneEntries.find((e) => e.slug === "kari")!;
    expect(cloneEntries.find((e) => e.slug === "ola")!.draft.data.values.f_ref000000001).toEqual([cloneKari.id]);
  });

  it("deletes a type with its entries", async () => {
    expect(await deleteContentType(actorA(), typeId)).toMatchObject({ ok: true });
    expect(await getContentType(a.storeId, typeId)).toBeNull();
    expect(await getEntry(a.storeId, entryId)).toBeNull();
  });
});
