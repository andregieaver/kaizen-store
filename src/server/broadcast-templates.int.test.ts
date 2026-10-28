import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";

vi.mock("server-only", () => ({}));

const bc = await import("./broadcasts");
const tpl = await import("./broadcast-templates");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let storeId = "";
let otherId = "";
let owner = "";

const content: BroadcastContent = {
  "nb-NO": { subject: "Høstnytt", preview: "Det nye", blocks: [{ type: "heading", text: "Høst" }, { type: "paragraph", text: "Nye ting i butikken." }] },
  "en-GB": { subject: "Autumn news", preview: "", blocks: [{ type: "heading", text: "Autumn" }] },
};

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO', 'en-GB'] where id = ${id}::uuid`);
  return id;
}

beforeAll(async () => {
  storeId = await makeStore("btpl");
  otherId = await makeStore("btpl-other");
  const [acc] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(acc.account_id);
});

afterAll(async () => {
  await closeDb();
});

/** Broadcast templates (D368): the hand-written ones start a broadcast in the store's languages; a broadcast's words are kept as the store's own. */
describe("broadcast templates", () => {
  it("starts from a hand-written template in the store's languages, or from nothing", async () => {
    const news = await tpl.startingContent(storeId, ["nb-NO", "en-GB"], "news");
    expect(Object.keys(news)).toEqual(["nb-NO", "en-GB"]);
    expect(news["nb-NO"].subject).toBe("Nytt fra oss");
    expect(await tpl.startingContent(storeId, ["nb-NO"], null)).toEqual({});
    expect(await tpl.startingContent(storeId, ["nb-NO"], "no-such-template")).toEqual({});
  });

  it("keeps a broadcast's words as the store's own template, audited, never another store's", async () => {
    const store = (await storeById(storeId))!;
    const saved = await bc.saveBroadcast(store, owner, null, { title: "Autumn", audience: "everyone", segmentId: null, content });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await tpl.saveAsTemplate(storeId, owner, saved.id, "  ")).toEqual({ ok: false, problem: "title" });
    expect(await tpl.saveAsTemplate(otherId, owner, saved.id, "Theirs")).toEqual({ ok: false, problem: "unknown" });
    const made = await tpl.saveAsTemplate(storeId, owner, saved.id, "Autumn template");
    if (!made.ok) throw new Error(made.problem);
    expect((await tpl.listOwnTemplates(storeId)).map((t) => t.title)).toEqual(["Autumn template"]);
    expect(await tpl.listOwnTemplates(otherId)).toEqual([]);
    // It starts the next broadcast with the store's languages only, and only in its own store.
    expect(await tpl.startingContent(storeId, ["nb-NO"], made.id)).toEqual({ "nb-NO": content["nb-NO"] });
    expect(await tpl.startingContent(otherId, ["nb-NO", "en-GB"], made.id)).toEqual({});
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'broadcast_template.saved'`);
    expect(audited.n).toBe(1);
    expect(await tpl.deleteOwnTemplate(otherId, owner, made.id)).toBe(false);
    expect(await tpl.deleteOwnTemplate(storeId, owner, made.id)).toBe(true);
    expect(await tpl.listOwnTemplates(storeId)).toEqual([]);
  });
});
