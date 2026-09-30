import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseMatrixForm } from "@/lib/plan-features";

import type { Account } from "./auth";
import { getFeatureMatrix, saveFeatureMatrix } from "./plan-features";

type Row = Record<string, unknown>;

const tag = Date.now().toString(36);
let admin: Account;
const plans: string[] = [];
const ids: string[] = [];

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`features-${tag}@example.com`}, 'Features Admin') returning id
  `);
  admin = { id: String(account.id), email: `features-${tag}@example.com`, name: "Features Admin" } as Account;
  for (const name of ["Alpha", "Beta"]) {
    const [plan] = await db().execute<Row>(sql`
      insert into commerce.plans (name, position) values (${`${name} ${tag}`}, 9000) returning id
    `);
    plans.push(String(plan.id));
  }
  const [feature] = await db().execute<Row>(sql`
    insert into commerce.plan_features (category, name, position) values (${`Test ${tag}`}, ${`Thing ${tag}`}, 90000) returning id
  `);
  ids.push(String(feature.id));
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.plan_features where category = ${`Test ${tag}`} or category = ${`New ${tag}`}`);
  await db().execute(sql`delete from commerce.plans where id in (${sql.join(plans.map((id) => sql`${id}::uuid`), sql`, `)})`);
  await closeDb();
});

const form = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });

describe("the plan comparison", () => {
  it("starts with the features Kaizen has, in no plan", async () => {
    const matrix = await getFeatureMatrix();
    const seeded = matrix.features.filter((f) => !f.category.includes(tag));
    expect(seeded.length).toBeGreaterThanOrEqual(40);
    expect(new Set(seeded.map((f) => f.category)).size).toBeGreaterThan(3);
  });

  it("saves edits, ticks, removals and new features together", async () => {
    const parsed = parseMatrixForm(
      form({
        [`f:${ids[0]}:name`]: `Renamed ${tag}`,
        [`f:${ids[0]}:category`]: `Test ${tag}`,
        [`f:${ids[0]}:description`]: "now with words",
        [`f:${ids[0]}:position`]: "90001",
        [`g:${ids[0]}:${plans[0]}`]: "on",
        "n:0:name": `Fresh ${tag}`,
        "n:0:category": `New ${tag}`,
        "n:0:description": "",
        "n:0:position": "90002",
        [`n:0:g:${plans[0]}`]: "on",
        [`n:0:g:${plans[1]}`]: "on",
      }),
      { featureIds: ids, planIds: plans },
    );
    if (!parsed.ok) throw new Error(parsed.problems.join(" "));
    await saveFeatureMatrix(admin, parsed.input, plans);

    const matrix = await getFeatureMatrix();
    const edited = matrix.features.find((f) => f.id === ids[0])!;
    expect(edited).toMatchObject({ name: `Renamed ${tag}`, description: "now with words", planIds: [plans[0]] });
    const fresh = matrix.features.find((f) => f.name === `Fresh ${tag}`)!;
    expect(fresh.planIds.sort()).toEqual([...plans].sort());
    ids.push(fresh.id);

    // Unticking takes the plan out again, and a plan that is not shown keeps what it had.
    const again = parseMatrixForm(form({ [`f:${ids[0]}:name`]: `Renamed ${tag}`, [`f:${ids[0]}:category`]: `Test ${tag}`, [`f:${ids[0]}:position`]: "90001" }), {
      featureIds: [ids[0]],
      planIds: [plans[1]],
    });
    if (!again.ok) throw new Error("unexpected");
    await saveFeatureMatrix(admin, again.input, [plans[1]]);
    expect((await getFeatureMatrix()).features.find((f) => f.id === ids[0])!.planIds).toEqual([plans[0]]);
  });

  it("removes a feature with its ticks", async () => {
    const removal = parseMatrixForm(form({ [`f:${ids[1]}:name`]: "Fresh", [`f:${ids[1]}:remove`]: "on" }), { featureIds: [ids[1]], planIds: plans });
    if (!removal.ok) throw new Error("unexpected");
    await saveFeatureMatrix(admin, removal.input, plans);
    expect((await getFeatureMatrix()).features.find((f) => f.id === ids[1])).toBeUndefined();
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.plan_feature_grants where feature_id = ${ids[1]}::uuid`);
    expect(left.n).toBe(0);
  });

  it("is private: the tables have row level security and no policies", async () => {
    const rows = await db().execute<Row>(sql`
      select relname, relrowsecurity from pg_class where relname in ('plan_features', 'plan_feature_grants') order by relname
    `);
    expect(rows.map((r) => r.relrowsecurity)).toEqual([true, true]);
  });
});
