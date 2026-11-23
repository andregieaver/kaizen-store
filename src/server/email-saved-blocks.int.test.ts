import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const saved = await import("./email-saved-blocks");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let storeId = "";
let otherId = "";
let owner = "";

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  return String(created.id);
}

beforeAll(async () => {
  storeId = await makeStore("esb");
  otherId = await makeStore("esb-other");
  const [acc] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(acc.account_id);
});

afterAll(async () => {
  await closeDb();
});

const social = { type: "social", links: [{ network: "instagram", url: "instagram.com/kaizena" }] };

/** Saved email blocks (email plan M4.1): a store's own, checked as an email's block, audited, and never another store's. */
describe("saved email blocks", () => {
  it("keeps a block by name, lists it newest first, and refuses an empty name, a broken block or a picture from elsewhere", async () => {
    expect(await saved.saveBlock(storeId, owner, "  ", social)).toEqual({ ok: false, problem: "name" });
    expect(await saved.saveBlock(storeId, owner, "Broken", { type: "social", links: [] })).toEqual({ ok: false, problem: "block" });
    expect(await saved.saveBlock(storeId, owner, "Picture", { type: "image", url: "https://elsewhere.example/a.jpg", alt: "", href: null })).toEqual({ ok: false, problem: "picture" });
    const first = await saved.saveBlock(storeId, owner, "Social", social);
    const second = await saved.saveBlock(storeId, owner, "Footer", { type: "paragraph", text: "Takk for at du handler hos oss." });
    expect(first.ok && second.ok).toBe(true);
    const list = await saved.listSavedBlocks(storeId);
    expect(list.map((b) => b.name)).toEqual(["Footer", "Social"]);
    expect(list[1].block).toEqual(social);
    expect(await saved.listSavedBlocks(otherId)).toEqual([]);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'email_block.saved'`);
    expect(Number(audited.n)).toBe(2);
  });

  it("deletes only the store's own", async () => {
    const [block] = await saved.listSavedBlocks(storeId);
    expect(await saved.deleteSavedBlock(otherId, owner, block.id)).toBe(false);
    expect(await saved.deleteSavedBlock(storeId, owner, block.id)).toBe(true);
    expect((await saved.listSavedBlocks(storeId)).map((b) => b.name)).toEqual(["Social"]);
  });

  it("stops at the most a store may keep", async () => {
    await db().execute(sql`
      insert into commerce.email_saved_blocks (store_id, name, block)
      select ${storeId}::uuid, 'Fill ' || n, '{"type":"divider"}'::jsonb from generate_series(1, 49) n
    `);
    expect(await saved.saveBlock(storeId, owner, "One more", social)).toEqual({ ok: false, problem: "full" });
  });
});
