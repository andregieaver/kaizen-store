import { randomBytes } from "node:crypto";

import sharp from "sharp";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
// Storage is Supabase's: here an upload is kept under the address it would have.
vi.mock("./media", async (original) => ({
  ...(await original<typeof import("./media")>()),
  uploadProductImage: async (folder: string, image: File) => {
    const path = `${folder}/${Date.now().toString(36)}-${image.name}`;
    const url = `https://files.example.com/storage/v1/object/public/product-media/${path}`;
    return { ok: true, url, thumbnailUrl: `${url}-480`, stored: { bucket: "product-media", path, thumbnailPath: `${path}-480` } };
  },
}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const editor = await import("./picture-editor");
const library = await import("./media-library");

const run = Date.now().toString(36);
let storeId: string;
let accountId: string;
let otherStore: string;
let original: string;
let foreign: string;

const png = async (colour: string, size = 64) =>
  new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: colour } }).png().toBuffer());

/** A connection whose picture provider edits: no request leaves the test, the edit is given as `deps.edit`. */
const connection = (editModel: string | null) =>
  ({
    source: "store",
    apiUrl: "https://ai.example.com/v1",
    apiKey: "test",
    image: { provider: "openai", apiUrl: "https://ai.example.com/v1", apiKey: "test", model: "picture-model", quality: null, editModel },
  }) as unknown as import("./ai").AiConnection;

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`);
  return { id: String(store.id), account: String(account.id) };
}

async function addPicture(store: string, name: string) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, width, height, alt, alt_source)
    values (${store}::uuid, 'image', ${`https://files.example.com/${store}/${run}-${name}`}, 'product-media', ${`${store}/${run}-${name}`},
      ${name}, 'image/png', 1000, 64, 64, 'A white mug on a table', 'staff')
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  const own = await makeStore(`edit-${run}`);
  storeId = own.id;
  accountId = own.account;
  otherStore = (await makeStore(`edit-other-${run}`)).id;
  original = await addPicture(storeId, "mug.png");
  foreign = await addPicture(otherStore, "theirs.png");
});

afterAll(async () => {
  await closeDb();
});

const owner = () => ({ store: { id: storeId } as never, accountId });

describe("editing a library picture with AI (D349)", () => {
  it("keeps the edit beside the original, marked as the AI's and naming it, from the file read by its row", async () => {
    const asked: { prompt: string; type: string; width: number | undefined }[] = [];
    const result = await editor.editLibraryPicture(
      owner(),
      { mediaId: original, action: "new_background", brief: "a wooden table by a window" },
      {
        connection: connection("edit-model"),
        read: async (bucket, path) => {
          expect(bucket).toBe("product-media");
          expect(path).toBe(`${storeId}/${run}-mug.png`);
          return png("#ffffff", 2000);
        },
        edit: async (_connection, picture, prompt) => {
          asked.push({ prompt, type: picture.contentType, width: (await sharp(picture.bytes).metadata()).width });
          return { bytes: await png("#336699", 512) };
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sent as a PNG of at most 1024 pixels, with the change and the rules.
    expect(asked).toEqual([{ prompt: expect.stringContaining("a wooden table by a window."), type: "image/png", width: 1024 }]);
    expect(result.picture.alt).toBe("A white mug on a table");
    const [edited] = await db().execute<Row>(sql`
      select made_by, edited_from, file_name, alt, alt_source from commerce.media where id = ${result.picture.id}::uuid
    `);
    expect(edited).toEqual({ made_by: "ai_edited", edited_from: original, file_name: "mug-edited.webp", alt: "A white mug on a table", alt_source: "ai" });
    // The original is never written over.
    const [kept] = await db().execute<Row>(sql`select made_by, url from commerce.media where id = ${original}::uuid`);
    expect(kept).toEqual({ made_by: "person", url: `https://files.example.com/${storeId}/${run}-mug.png` });

    // Copied into another library (a template's picture, a store copy), it stays the AI's, without naming the other owner's original.
    const files = await library.libraryFilesByUrl(storeId, [result.picture.url]);
    const file = files.get(result.picture.url);
    expect(file?.madeBy).toBe("ai_edited");
    const copy = await library.copyToLibrary({ storeId: otherStore, accountId }, file!, async (_bucket, _from, to) => `https://files.example.com/copied/${to}`);
    const [copied] = await db().execute<Row>(sql`select made_by, edited_from from commerce.media where url = ${copy!.url}`);
    expect(copied).toEqual({ made_by: "ai_edited", edited_from: null });
  });

  it("refuses another store's picture, a missing description, and a site with no edit model, before anything is sent", async () => {
    const edit = vi.fn();
    const deps = { connection: connection("edit-model"), read: async () => png("#ffffff"), edit };
    expect(await editor.editLibraryPicture(owner(), { mediaId: foreign, action: "remove_background" }, deps)).toEqual({
      ok: false,
      problem: "That picture is not in the library.",
    });
    expect(await editor.editLibraryPicture(owner(), { mediaId: original, action: "change", brief: "x" }, deps)).toMatchObject({ ok: false });
    expect(await editor.editLibraryPicture(owner(), { mediaId: original, action: "draw" }, deps)).toMatchObject({ ok: false });
    expect(
      await editor.editLibraryPicture(owner(), { mediaId: original, action: "remove_background" }, { ...deps, connection: connection(null) }),
    ).toMatchObject({ ok: false, problem: expect.stringContaining("no model that edits pictures") });
    expect(edit).not.toHaveBeenCalled();
  });

  it("says why when the provider fails, and keeps nothing", async () => {
    const before = await db().execute<Row>(sql`select count(*)::int as n from commerce.media where store_id = ${storeId}::uuid`);
    const result = await editor.editLibraryPicture(
      owner(),
      { mediaId: original, action: "remove_background" },
      {
        connection: connection("edit-model"),
        read: async () => png("#ffffff"),
        edit: async () => {
          throw new ai.AiError("No answer within 150 seconds.");
        },
      },
    );
    expect(result).toEqual({ ok: false, problem: "The picture could not be edited: No answer within 150 seconds." });
    const after = await db().execute<Row>(sql`select count(*)::int as n from commerce.media where store_id = ${storeId}::uuid`);
    expect(after[0].n).toBe(before[0].n);
  });

  it("asks the provider's /images/edits with the edit model and reads its picture", async () => {
    const answer = Buffer.from(await png("#123456")).toString("base64");
    const calls: { url: string; model: unknown; image: boolean }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const form = init.body as FormData;
        calls.push({ url, model: form.get("model"), image: form.get("image") instanceof Blob });
        return Response.json({ data: [{ b64_json: answer }] });
      }),
    );
    try {
      const edited = await ai.editImage(connection("edit-model"), { bytes: await png("#ffffff"), contentType: "image/png" }, "Remove the background.");
      expect(edited.bytes.byteLength).toBeGreaterThan(0);
      expect(calls).toEqual([{ url: "https://ai.example.com/v1/images/edits", model: "edit-model", image: true }]);
      await expect(ai.editImage(connection(null), { bytes: await png("#ffffff"), contentType: "image/png" }, "x")).rejects.toThrow(/No model that edits/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
