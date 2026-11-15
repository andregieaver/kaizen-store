import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { owned } = await import("./owned");

const STORE = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
const render = (fragment: ReturnType<typeof owned>) => new PgDialect().sqlToQuery(fragment);

describe("owned()", () => {
  it("is an equality the store's index serves for a store", () => {
    expect(render(owned(STORE))).toMatchObject({ sql: "store_id = $1::uuid", params: [STORE] });
  });

  it("is `is null`, with no parameter, for the platform", () => {
    expect(render(owned(null))).toMatchObject({ sql: "store_id is null", params: [] });
  });

  it("names an aliased column", () => {
    expect(render(owned(STORE, sql`p.store_id`))).toMatchObject({ sql: "p.store_id = $1::uuid", params: [STORE] });
    expect(render(owned(null, sql`p.store_id`))).toMatchObject({ sql: "p.store_id is null", params: [] });
  });

  it("takes an empty id as the platform's, as the private copies did", () => {
    expect(render(owned(""))).toMatchObject({ sql: "store_id is null", params: [] });
  });
});
