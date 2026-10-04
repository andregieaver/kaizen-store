import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const mcp = await import("./store-mcp");
const ai = await import("./ai");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const CLIENT = "kaizen-life-client-id";
const authUser = crypto.randomUUID();
let caller: Awaited<ReturnType<typeof mcp.callerFromClaims>>;
let slug: string;
let handle: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`mcp-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`mcp-${run}`}, 'Kaffe', null) as id`);
  slug = `mcp-${run}`;
  await db().execute(sql`update commerce.accounts set auth_user_id = ${authUser}::uuid where email = ${`mcp-${run}@example.com`}`);
  const [product] = await db().execute<Row>(sql`select handle from commerce.products where store_id = ${String(store.id)}::uuid and status = 'active' order by handle limit 1`);
  handle = String(product.handle);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await closeDb();
});

const claims = (extra: Record<string, unknown> = {}) => ({ sub: authUser, client_id: CLIENT, exp: Date.now() / 1000 + 600, ...extra });

describe("the store's MCP server for Kaizen Life (D96)", () => {
  it("takes only Kaizen Life's unexpired tokens, for an owner", async () => {
    caller = await mcp.callerFromClaims(claims(), CLIENT);
    expect(caller?.stores).toEqual([expect.objectContaining({ slug, name: "Kaffe" })]);
    expect(await mcp.callerFromClaims(claims({ client_id: "another-app" }), CLIENT)).toBeNull();
    expect(await mcp.callerFromClaims(claims({ exp: Date.now() / 1000 - 1 }), CLIENT)).toBeNull();
    expect(await mcp.callerFromClaims(claims({ sub: crypto.randomUUID() }), CLIENT)).toBeNull();
  });

  it("serves a store that requires two-step, and a platform admin, to a token that passed the second step only (aal2)", async () => {
    // A token at aal1 still reaches a store that does not require two-step ...
    expect((await mcp.callerFromClaims(claims({ aal: "aal1" }), CLIENT))?.aal).toBe("aal1");
    expect((await mcp.callerFromClaims(claims({ aal: "aal2" }), CLIENT))?.aal).toBe("aal2");
    // ... but not one that requires it: the store is left out for aal1, and a caller with no store left is refused.
    await db().execute(sql`update commerce.stores set require_two_step = true where slug = ${slug}`);
    try {
      expect(await mcp.callerFromClaims(claims({ aal: "aal1" }), CLIENT)).toBeNull();
      expect(await mcp.callerFromClaims(claims(), CLIENT)).toBeNull();
      expect((await mcp.callerFromClaims(claims({ aal: "aal2" }), CLIENT))?.stores).toEqual([expect.objectContaining({ slug })]);
    } finally {
      await db().execute(sql`update commerce.stores set require_two_step = false where slug = ${slug}`);
    }
    // A platform admin is served at aal2 only, wherever they sign in.
    await db().execute(sql`update commerce.accounts set platform_admin = true where auth_user_id = ${authUser}::uuid`);
    try {
      expect(await mcp.callerFromClaims(claims({ aal: "aal1" }), CLIENT)).toBeNull();
      expect(await mcp.callerFromClaims(claims({ aal: "aal2" }), CLIENT)).not.toBeNull();
    } finally {
      await db().execute(sql`update commerce.accounts set platform_admin = false where auth_user_id = ${authUser}::uuid`);
    }
  });

  it("lists every tool with the store it is for, and answers from the owner's stores only", async () => {
    expect(mcp.MCP_TOOLS.find((t) => t.name === "sales_summary")?.inputSchema).toMatchObject({ required: ["store"] });
    expect(await mcp.callMcpTool(caller!, "list_stores", {}, () => {})).toEqual({
      content: [{ type: "text", text: JSON.stringify({ stores: [{ slug, name: "Kaffe" }] }) }],
    });
    const overview = await mcp.callMcpTool(caller!, "store_overview", { store: slug }, () => {});
    expect(overview.content[0].text).toContain('"name":"Kaffe"');
    expect(await mcp.callMcpTool(caller!, "store_overview", { store: "demo" }, () => {})).toMatchObject({ isError: true });
  });

  it("keeps changes for the owner's approval in the store's admin, never making them", async () => {
    const answer = await mcp.callMcpTool(caller!, "archive_product", { store: slug, product: handle }, () => {});
    expect(JSON.parse(answer.content[0].text)).toMatchObject({ kept_for_approval: true, what: `Take the product "${handle}" off the site.` });
    const [product] = await db().execute<Row>(sql`select p.status from commerce.products p join commerce.stores s on s.id = p.store_id where s.slug = ${slug} and p.handle = ${handle}`);
    expect(product.status).toBe("active");
    const [conversation] = await db().execute<Row>(sql`
      select c.title, (select count(*)::int from commerce.assistant_approvals a where a.conversation_id = c.id and a.status = 'pending') as waiting
      from commerce.assistant_conversations c join commerce.stores s on s.id = c.store_id
      where s.slug = ${slug} and c.source = 'kaizen-life'
    `);
    expect(conversation).toEqual({ title: "From Kaizen Life", waiting: 1 });
  });

  it("asks the store's own assistant, in the owner's Kaizen Life conversation", async () => {
    vi.spyOn(ai, "aiFor").mockResolvedValue({ provider: "openai", apiUrl: "https://ai.example/v1", apiKey: "k", textModel: "m", textEuOnly: false } as never);
    vi.spyOn(ai, "streamWithTools").mockImplementation(async (_c, _m, _t, onText) => {
      onText("Kaffe har ingen salg i dag.");
      return { content: "Kaffe har ingen salg i dag.", toolCalls: [] };
    });
    const answer = await mcp.callMcpTool(caller!, "ask_store_assistant", { store: slug, question: "Hvordan går salget?" }, () => {});
    expect(JSON.parse(answer.content[0].text)).toEqual({ answer: "Kaffe har ingen salg i dag." });
    const [count] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.assistant_messages m join commerce.assistant_conversations c on c.id = m.conversation_id
      join commerce.stores s on s.id = c.store_id where s.slug = ${slug} and c.source = 'kaizen-life'
    `);
    expect(count.n).toBe(2);
  });
});
