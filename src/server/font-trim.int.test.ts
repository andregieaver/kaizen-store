import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { trimFontFiles } = await import("./font-trim");

/** Montserrat cut to a few letters with its whole weight axis (`src/lib/fixtures/fonts`, SIL Open Font License). */
const SAMPLE = readFileSync(join(process.cwd(), "src/lib/fixtures/fonts/montserrat-sample.woff2"));
const run = Date.now().toString(16).padStart(16, "0");
const VARIABLE = `${run}${"a".repeat(16)}.woff2`;
const ORPHAN = `${run}${"b".repeat(16)}.woff2`;
const BROKEN = `${run}${"c".repeat(16)}.woff2`;
let ownsFamily = false;

afterAll(async () => {
  await db().execute(sql`delete from commerce.font_files where name in (${VARIABLE}, ${ORPHAN}, ${BROKEN})`);
  if (ownsFamily) await db().execute(sql`delete from commerce.fonts where family = 'Montserrat'`);
  await closeDb();
});

/** Each file's bytes and whether the trimmer has looked at it. */
async function files() {
  const rows = await db().execute<{ name: string; data: Uint8Array; trimmed_at: Date | null }>(
    sql`select name, data, trimmed_at from commerce.font_files where name in (${VARIABLE}, ${ORPHAN}, ${BROKEN})`,
  );
  return new Map(rows.map((row) => [row.name, { bytes: row.data.byteLength, looked: row.trimmed_at !== null }]));
}

describe("self-hosted fonts cut to their families' weights (D59)", () => {
  it("cuts each file once, under its own name, and marks the ones it leaves", async () => {
    await db().execute(sql`
      insert into commerce.font_files (name, data) values (${VARIABLE}, ${SAMPLE}), (${ORPHAN}, ${SAMPLE}), (${BROKEN}, ${new TextEncoder().encode("not a font")})
    `);
    // Montserrat's stylesheet names two of them; the third no family uses.
    const css = `/* latin */\n@font-face { font-family: 'Montserrat'; font-style: normal; font-weight: 400; src: url(/api/fonts/files/${VARIABLE}) format('woff2'); }\n/* latin */\n@font-face { font-family: 'Montserrat'; font-style: italic; font-weight: 400; src: url(/api/fonts/files/${BROKEN}) format('woff2'); }\n`;
    const inserted = await db().execute(sql`
      insert into commerce.fonts (family, slug, category, css, bytes) values ('Montserrat', 'montserrat', 'sans-serif', ${css}, ${SAMPLE.length})
      on conflict (family) do nothing returning family
    `);
    ownsFamily = inserted.length === 1;
    expect(ownsFamily).toBe(true);

    // Other tests' files may be older and come first: the job goes on until it has looked at these.
    for (let i = 0; i < 20 && [...(await files()).values()].some((file) => !file.looked); i++) await trimFontFiles();
    const after = await files();
    expect(after.get(VARIABLE)).toEqual({ bytes: expect.any(Number), looked: true });
    expect(after.get(VARIABLE)!.bytes).toBeLessThan(SAMPLE.length);
    // No stylesheet names it, so no family says which weights: left whole. One HarfBuzz cannot read: left whole too.
    expect(after.get(ORPHAN)).toEqual({ bytes: SAMPLE.length, looked: true });
    expect(after.get(BROKEN)).toEqual({ bytes: 10, looked: true });

    // Looked at once: a later run leaves them alone.
    const cut = after.get(VARIABLE)!.bytes;
    await trimFontFiles();
    expect((await files()).get(VARIABLE)!.bytes).toBe(cut);
  });
});
