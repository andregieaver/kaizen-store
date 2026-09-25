import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));

const saved = await import("./saved-parts");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;

const text = (id: string, words: string) => ({
  id,
  type: "richText",
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] },
});

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`saved-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true };
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.saved_parts where name like ${`%${run}`}`);
  await closeDb();
});

describe("saved rows, columns and components", () => {
  it("saves each kind, lists them, renames and changes one, and deletes it", async () => {
    const row = await saved.createSavedPart(admin, {
      kind: "row",
      name: `Hero ${run}`,
      content: { id: "r", type: "row", layout: "2", columns: [{ id: "c1", blocks: [text("b1", "Left")] }, { id: "c2", blocks: [] }] },
    });
    expect(row.ok).toBe(true);
    const column = await saved.createSavedPart(admin, { kind: "column", name: `Aside ${run}`, content: { id: "c", blocks: [] } });
    const block = await saved.createSavedPart(admin, { kind: "block", name: `Promise ${run}`, content: text("b", "Fast.") });
    if (!row.ok || !column.ok || !block.ok) throw new Error("not saved");

    const mine = (await saved.listSavedParts()).filter((p) => p.name.endsWith(run));
    expect(mine.map((p) => [p.kind, p.name])).toEqual([
      ["block", `Promise ${run}`],
      ["column", `Aside ${run}`],
      ["row", `Hero ${run}`],
    ]);

    const changed = await saved.updateSavedPart(admin, block.id, { kind: "block", name: `Promise v2 ${run}`, content: text("b", "Faster.") });
    expect(changed.ok && changed.parts.find((p) => p.id === block.id)).toMatchObject({ name: `Promise v2 ${run}`, content: { doc: { content: [{ content: [{ text: "Faster." }] }] } } });
    // A saved part keeps its kind.
    expect(await saved.updateSavedPart(admin, block.id, { kind: "column", name: "x", content: { id: "c", blocks: [] } })).toEqual({
      ok: false,
      problems: ["This saved part no longer exists."],
    });

    await saved.deleteSavedPart(admin, column.id);
    expect((await saved.listSavedParts()).some((p) => p.id === column.id)).toBe(false);
  });

  it("refuses a nameless part, unsafe text and a row with the wrong columns", async () => {
    const results = await Promise.all([
      saved.createSavedPart(admin, { kind: "block", name: " ", content: text("b", "x") }),
      saved.createSavedPart(admin, {
        kind: "block",
        name: `Bad ${run}`,
        content: {
          id: "b",
          type: "richText",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
        },
      }),
      saved.createSavedPart(admin, { kind: "row", name: `Bad row ${run}`, content: { id: "r", type: "row", layout: "3", columns: [] } }),
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(results[0]).toMatchObject({ problems: ["Give it a name."] });
  });
});
