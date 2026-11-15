import { randomUUID } from "node:crypto";

import { sql, type SQLWrapper } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

// Every statement the page reads send, to be explained afterwards (db() and readDb() both).
const sent: SQLWrapper[] = [];
vi.mock("@/db/client", async (original) => {
  const real = await original<typeof import("@/db/client")>();
  const wrap = (make: () => ReturnType<typeof real.db>) => () =>
    new Proxy(make(), {
      get(target, property, receiver) {
        if (property === "execute")
          return (query: SQLWrapper) => {
            sent.push(query);
            return target.execute(query as never);
          };
        return Reflect.get(target, property, receiver);
      },
    });
  return { ...real, db: wrap(real.db), readDb: wrap(real.readDb as never) };
});

const { findPublishedPage, listPublishedPages, publishedPageNames } = await import("./pages");
const { usesRememberedModals } = await import("./page-modals");

type Row = Record<string, unknown>;
type PlanNode = { "Node Type"?: string; "Index Cond"?: string; "Recheck Cond"?: string; Plans?: PlanNode[] };

/** Every node of a plan, the root first. */
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

// The plan does not depend on the store existing: any owner id gives the planner the same equality to put in an index.
const storeId = randomUUID();

afterAll(async () => {
  await closeDb();
});

class Rollback extends Error {}

/**
 * With `is not distinct from` store_id was only ever a Filter: Postgres cannot answer that from an index. With sequential scans off the
 * planner must choose an index when one can serve the condition, so the table needs no hundreds of owners for the assertion.
 */
describe("a page read is served by the store's index", () => {
  const statements = (owner: string | null) => [
    ["listPublishedPages", () => listPublishedPages(owner)],
    ["findPublishedPage", () => findPublishedPage(owner, "about")],
    ["publishedPageNames", () => publishedPageNames(owner, null, "page")],
    ["usesRememberedModals", () => usesRememberedModals(owner)],
  ] as const;

  for (const label of ["a store", "the platform"]) {
    it(`has store_id in an Index Cond for ${label}`, async () => {
      const owner = label === "a store" ? storeId : null;
      const captured: [string, SQLWrapper][] = [];
      for (const [name, call] of statements(owner)) {
        sent.length = 0;
        await call();
        expect(sent.length, `${name} sent one statement`).toBeGreaterThanOrEqual(1);
        captured.push([name, sent[0]]);
      }
      const plans: [string, PlanNode[]][] = [];
      await db()
        .transaction(async (tx) => {
          await tx.execute(sql`set local enable_seqscan = off`);
          for (const [name, query] of captured) {
            const [row] = await tx.execute<Row>(sql`explain (format json) ${query}`);
            const plan = (row["QUERY PLAN"] as { Plan: PlanNode }[])[0].Plan;
            plans.push([name, nodes(plan)]);
          }
          throw new Rollback();
        })
        .catch((error) => {
          if (!(error instanceof Rollback)) throw error;
        });
      expect(plans).toHaveLength(4);
      for (const [name, all] of plans) {
        const conditions = all.flatMap((n) => [n["Index Cond"], n["Recheck Cond"]]).filter(Boolean);
        expect(
          conditions.some((c) => String(c).includes("store_id")),
          `${name} for ${label}: store_id is in an Index Cond (plan: ${JSON.stringify(all.map((n) => [n["Node Type"], n["Index Cond"]]))})`,
        ).toBe(true);
      }
    });
  }
});
