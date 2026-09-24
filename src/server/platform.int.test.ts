import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));

const { createStoreForOwner } = await import("./platform");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let owner: Account;
let stranger: Account;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`multi-${run}@example.com`}, 'Kari', 'First store') returning id
  `);
  await db().execute(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`first-${run}`}, 'First store', null)
  `);
  const [account] = await db().execute<Row>(sql`
    select id, email from commerce.accounts where lower(email) = ${`multi-${run}@example.com`}
  `);
  owner = { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false };
  const [other] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`nobody-${run}@example.com`}, 'Nobody') returning id, email
  `);
  stranger = { id: String(other.id), email: String(other.email), name: "Nobody", platformAdmin: false };
});

afterAll(async () => {
  await closeDb();
});

describe("owners creating more stores", () => {
  it("gives an owner a second store, copied from the demo, with them as owner", async () => {
    const result = await createStoreForOwner(owner, "Second store", `second-${run}`);
    expect(result).toEqual({ ok: true, slug: `second-${run}` });
    const [row] = await db().execute<Row>(sql`
      select m.role,
             (select count(*)::int from commerce.products p where p.store_id = s.id) as products
      from commerce.stores s join commerce.store_members m on m.store_id = s.id
      where s.slug = ${`second-${run}`} and m.account_id = ${owner.id}::uuid
    `);
    expect(row.role).toBe("owner");
    expect(Number(row.products)).toBeGreaterThan(0);
  });

  it("refuses people who own no store, taken addresses and reserved ones", async () => {
    expect(await createStoreForOwner(stranger, "Mine", `mine-${run}`)).toMatchObject({ ok: false });
    expect(await createStoreForOwner(owner, "Again", `second-${run}`)).toEqual({
      ok: false,
      problems: [`The address second-${run} is taken. Choose another.`],
    });
    expect(await createStoreForOwner(owner, "Stores", "stores")).toEqual({
      ok: false,
      problems: ["Store address: That address is reserved."],
    });
  });
});
