import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { webpHasXmp } from "@/lib/webp-xmp";

vi.mock("server-only", () => ({}));

const { markAiPictures } = await import("./ai-picture-marks");
const { aiSourceXmp } = await import("./ai-pictures");

type Row = Record<string, unknown>;

/**
 * AI pictures made before their files were marked (AI Act Art. 50(2)) against a real database and a stand-in Storage: an unmarked one is
 * written back with IPTC's digital source type and the same pixels, one already marked is only recorded, a person's picture is never read,
 * and a file Storage will not take leaves the picture unmarked for the next run.
 */
const RUN = Date.now().toString(36);
const files = new Map<string, Uint8Array>();
const writes: string[] = [];
let refuse = new Set<string>();
const storage = {
  read: async (_bucket: string, path: string) => files.get(path) ?? null,
  write: async (_bucket: string, path: string, bytes: Uint8Array) => {
    if (refuse.has(path)) return false;
    writes.push(path);
    files.set(path, bytes);
    return true;
  },
};

async function webp(seed: number, xmp?: string) {
  const raw = Buffer.alloc(24 * 16 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * seed) % 256;
  let image = sharp(raw, { raw: { width: 24, height: 16, channels: 3 } }).webp({ quality: 80 });
  if (xmp) image = image.withXmp(xmp);
  return new Uint8Array(await image.toBuffer());
}
const pixels = async (bytes: Uint8Array) => sharp(bytes).raw().toBuffer();

async function picture(tag: string, madeBy: "person" | "ai_made" | "ai_edited", bytes: Uint8Array): Promise<string> {
  const path = `marks-${RUN}/${tag}.webp`;
  const thumbnailPath = `marks-${RUN}/${tag}-480.webp`;
  files.set(path, bytes);
  files.set(thumbnailPath, bytes);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, made_by, created_at)
    values (null, 'image', ${`https://files.example.test/${path}`}, ${`https://files.example.test/${thumbnailPath}`}, 'media', ${path},
            ${thumbnailPath}, ${`${tag}.webp`}, 'image/webp', ${madeBy}, '2001-01-01T00:00:00Z')
    returning id
  `);
  return String(row.id);
}
const markedAt = async (id: string) => (await db().execute<Row>(sql`select ai_marked_at from commerce.media where id = ${id}::uuid`))[0].ai_marked_at;

afterAll(async () => {
  await db().execute(sql`delete from commerce.media where path like ${`marks-${RUN}/%`}`);
  await closeDb();
});

describe("marking the AI pictures made before marking (AI Act Art. 50(2))", () => {
  it("marks an unmarked one in place, records one already marked, never reads a person's, and retries a refused file", async () => {
    const original = await webp(7);
    const unmarked = await picture("made", "ai_made", original);
    const edited = await picture("edited", "ai_edited", await webp(11));
    const already = await picture("already", "ai_made", await webp(13, aiSourceXmp("made")));
    const person = await picture("person", "person", await webp(17));
    const failing = await picture("failing", "ai_made", await webp(19));
    refuse = new Set([`marks-${RUN}/failing-480.webp`]);

    await markAiPictures({ storage, limit: 500 });

    const made = files.get(`marks-${RUN}/made.webp`)!;
    expect(webpHasXmp(made)).toContain("trainedAlgorithmicMedia");
    expect(webpHasXmp(files.get(`marks-${RUN}/made-480.webp`)!)).toContain("trainedAlgorithmicMedia");
    expect(Buffer.compare(await pixels(made), await pixels(original))).toBe(0);
    expect(webpHasXmp(files.get(`marks-${RUN}/edited.webp`)!)).toContain("compositeWithTrainedAlgorithmicMedia");
    expect(await markedAt(unmarked)).not.toBeNull();
    expect(await markedAt(edited)).not.toBeNull();

    // Already marked: recorded, nothing written.
    expect(await markedAt(already)).not.toBeNull();
    expect(writes.filter((p) => p.includes("/already"))).toEqual([]);
    // A person's picture: never read, never marked.
    expect(writes.filter((p) => p.includes("/person"))).toEqual([]);
    expect(await markedAt(person)).toBeNull();
    // Storage refused its thumbnail: it waits for the next run.
    expect(await markedAt(failing)).toBeNull();

    refuse = new Set();
    await markAiPictures({ storage, limit: 500 });
    expect(await markedAt(failing)).not.toBeNull();
    expect(webpHasXmp(files.get(`marks-${RUN}/failing-480.webp`)!)).toContain("trainedAlgorithmicMedia");
  });
});
