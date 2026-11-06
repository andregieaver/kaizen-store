import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PLAN_WORDS_NB } from "@/lib/plan-words.nb";

import { createTestDatabase } from "./testing";

/**
 * Every row of the plan comparison the migrations write has its Norwegian (D142, D312, `PLAN_WORDS_NB`): a migration that adds a feature to
 * `commerce.plan_features` brings its category, name and description in Norwegian too, or `/no/pricing` shows it in English.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("the plan comparison in Norwegian", () => {
  it("has every feature's category, name and description", async () => {
    const { rows } = await db.query<{ category: string; name: string; description: string }>("select category, name, description from commerce.plan_features");
    expect(rows.length).toBeGreaterThan(80);
    const missing = rows.flatMap((row) => [row.category, row.name, row.description]).filter((text) => text !== "" && !Object.hasOwn(PLAN_WORDS_NB, text));
    expect(missing).toEqual([]);
  });
});
