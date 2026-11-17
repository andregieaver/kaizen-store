import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { countStatements, type StatementRecord } from "@/db/statement-count";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
// The platform's reads start at `kaizenDesk()`, which asks who is signed in. A test has no session, so only that one function answers with
// an owner of the platform; nothing in the app is bypassed and no statement of the screens is skipped (who is signed in is the cookie's).
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  requirePlatformReader: async () => ({ id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", name: "Kari", platformAdmin: true }),
}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { makeCapacityStore } = await import("./capacity-test-support");
const { getStore } = await import("./stores");
const screens = await import("./admin-screens");

/**
 * The statements of five admin screens (bloat review step 1.9, AD-12): the store shell, the store Home, the orders list, the products list
 * and the platform Home each run their reads through `src/server/admin-screens.ts`, and this counts what those send to a real database
 * (`src/db/statement-count.ts`). A screen that sends more statements than `admin-statements.baseline.json` fails; one that
 * sends fewer asks for the baseline to be lowered. The screens are still being redesigned, so the failure says which screen and the fix.
 */

type Figures = { statements: number };
type Baseline = Record<string, Figures>;

const FILE = new URL("./admin-statements.baseline.json", import.meta.url);
const WRITE = process.env.UPDATE_BASELINE === "1";
const SCREENS = ["storeShell", "storeHome", "ordersList", "productsList", "platformHome"] as const;
const fix = "UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/admin-statements.int.test.ts";

afterAll(async () => {
  await closeDb();
});

let member: Awaited<ReturnType<typeof memberOf>>;

async function memberOf() {
  const made = await makeCapacityStore("screens", randomBytes(4).toString("hex"));
  await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${made.id}::uuid`);
  const store = (await getStore(made.slug))!;
  return { account: { id: made.owner, email: made.email, name: "Kari", platformAdmin: false }, store, role: "owner" as const };
}

const measures: Record<(typeof SCREENS)[number], () => Promise<unknown>> = {
  storeShell: () => screens.storeShellReads(member),
  storeHome: () => screens.storeHomeReads(member),
  ordersList: () => screens.ordersListReads(member.store, {}),
  productsList: () => screens.productsListReads(member, { archived: false, needsFilter: false, canWrite: true, locale: "en" }),
  platformHome: async () => {
    await screens.platformShellReads();
    await screens.platformHomeReads();
  },
};

const measured: Partial<Record<(typeof SCREENS)[number], { figures: Figures; records: StatementRecord[] }>> = {};

beforeAll(async () => {
  member = await memberOf();
  for (const name of SCREENS) {
    // The first run warms what is cached per process; the second is the one counted.
    await measures[name]();
    const { statements, count } = await countStatements(measures[name]);
    measured[name] = { figures: { statements: count }, records: statements };
  }
  if (WRITE) {
    const out: Baseline = {};
    for (const name of SCREENS) out[name] = measured[name]!.figures;
    writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`);
  }
}, 120_000);

const baseline = (): Baseline => JSON.parse(readFileSync(FILE, "utf8")) as Baseline;

describe("admin screens' statements", () => {
  for (const name of SCREENS) {
    it(`${name} sends no more than its baseline, and the baseline is not above it`, () => {
      const now = measured[name]!.figures;
      const held = baseline()[name];
      // Only statements are held: the waves of a screen move with how many of the pool's five connections are free (a Promise.all of eight
      // reads queues some), so the same code gave 2 and 3 waves between runs; `waves()` is for a test that holds its own connections.
      for (const key of ["statements"] as const) {
        if (now[key] > held[key]) {
          throw new Error(
            `${name} now sends ${now[key]} ${key}, baseline ${held[key]}: read less, or accept the growth with ${fix} and say why in the commit message`,
          );
        }
        if (now[key] < held[key]) {
          throw new Error(`${name} now sends ${now[key]} ${key}, baseline ${held[key]}: lower the baseline with ${fix}`);
        }
      }
    });
  }

  it("keeps each statement's text, values and rows for the store shell", () => {
    const records = measured.storeShell!.records.filter((r) => !r.control);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(0);
      expect(Array.isArray(r.values)).toBe(true);
      expect(r.rows === null || typeof r.rows === "number").toBe(true);
    }
    expect(records.some((r) => r.values.length > 0)).toBe(true);
  });

  it("would notice one more statement in the store shell", async () => {
    const { count } = await countStatements(async () => {
      await screens.storeShellReads(member);
      await db().execute(sql`select 1`);
    });
    expect(count).toBe(baseline().storeShell.statements + 1);
  });
});
