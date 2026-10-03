import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
// The recommendation tool reads the visitor's cookies (cart, wishlist, account): this visitor has none.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
// Stock is read per request; a test has no request to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const { getStore } = await import("./stores");
const knowledge = await import("./knowledge");
const chat = await import("./chat-agent");
type AiConnection = import("./ai").AiConnection;
type Store = import("./stores").Store;

const run = Date.now().toString(36);
const slug = `chat-${run}`;
let storeId: string;
let accountId: string;
let store: Store;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Chat test', null) as id
  `);
  storeId = String(created.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`);
  accountId = String(account.id);
  store = (await getStore(slug))!;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeDb();
});

const account = () => ({ id: accountId, email: `${slug}@example.com` }) as never;

describe("the knowledge base (D81)", () => {
  it("cuts a document into passages and finds them by keyword in any language", async () => {
    const saved = await knowledge.saveDocument(account(), storeId, null, {
      title: "Retur og bytte",
      content: "Du kan returnere varer innen 30 dager.\n\nGavekort kan ikke byttes mot penger.",
    });
    expect(saved.ok).toBe(true);
    const [document] = await knowledge.listDocuments(storeId);
    expect(document).toMatchObject({ title: "Retur og bytte", passages: 1 });

    const found = await knowledge.searchKnowledge(storeId, "returnere", "nb-NO");
    expect(found[0]).toMatchObject({ title: "Retur og bytte", path: null });
    expect(found[0].body).toContain("30 dager");
    // Another store's knowledge base is its own.
    expect(await knowledge.searchKnowledge(null, "returnere", "nb-NO")).toEqual([]);

    await knowledge.deleteDocument(account(), storeId, document.id);
    expect(await knowledge.searchKnowledge(storeId, "returnere", "nb-NO")).toEqual([]);
  });

  it("refuses documents without text", async () => {
    const saved = await knowledge.saveDocument(account(), storeId, null, { title: "Empty", content: " \n " });
    expect(saved).toEqual({ ok: false, problems: [expect.stringContaining("no text")] });
  });

  it("reads the store's published pages in each of its languages, once per publishing", async () => {
    const first = await knowledge.syncPageKnowledge(storeId);
    expect(first.cut).toBeGreaterThan(0);
    expect((await knowledge.syncPageKnowledge(storeId)).cut).toBe(0);

    const [nb] = await knowledge.searchKnowledge(storeId, "hjem og kontor", "nb-NO");
    expect(nb).toMatchObject({ title: "Om oss", path: "/om-oss" });
    const [sv] = await knowledge.searchKnowledge(storeId, "butiken", "sv-SE");
    expect(sv.body).toContain("Vi säljer saker");

    // Unpublished pages are let go.
    await db().execute(sql`update commerce.pages set published_at = null, published = null where store_id = ${storeId}::uuid and slug = 'om-oss'`);
    expect((await knowledge.syncPageKnowledge(storeId)).dropped).toBeGreaterThan(0);
    expect(await knowledge.searchKnowledge(storeId, "hjem og kontor", "nb-NO")).toEqual([]);
  });
});

describe("the chat's limits", () => {
  it("counts a visitor's messages and the site's day apart", async () => {
    expect(await chat.takeChatTurn(storeId, "visitor-a", 2)).toBe("ok");
    expect(await chat.takeChatTurn(storeId, "visitor-b", 2)).toBe("ok");
    expect(await chat.takeChatTurn(storeId, "visitor-c", 2)).toBe("closed");
    for (let i = 0; i < chat.VISITOR_LIMIT; i++) await chat.takeChatTurn(storeId, "visitor-d", 100_000);
    expect(await chat.takeChatTurn(storeId, "visitor-d", 100_000)).toBe("busy");
    expect(chat.visitorKey("192.0.2.1")).toMatch(/^[0-9a-f]{32}$/);
    expect(chat.visitorKey("192.0.2.1")).not.toBe(chat.visitorKey("192.0.2.2"));
  });
});

describe("the agent", () => {
  const connection = {
    provider: "openai",
    source: "platform",
    apiUrl: "https://ai.example.com/v1",
    apiKey: "sk-test",
    textModel: "text-model",
    embeddingModel: null,
    space: null,
  } as unknown as AiConnection;

  /** Answers the model's steps in turn, and keeps what it was sent. */
  function fakeModel(steps: Row[]) {
    const sent: Row[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
        sent.push(JSON.parse(String(init.body)) as Row);
        const message = steps.shift() ?? { content: "…" };
        return Response.json({ choices: [{ message }] });
      }),
    );
    return sent;
  }

  const call = (id: string, name: string, args: Row) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

  it("searches, opens a page for the visitor, and answers without claims", async () => {
    const market = store.markets.find((m) => m.code === "NO")!;
    const sent = fakeModel([
      { content: null, tool_calls: [call("1", "search_products", { query: "bordlampe" }), call("2", "navigate", { to: "product", handle: "demo-bordlampe" })] },
      { content: "Her er bordlampen. Den er klimanøytral. Jeg har åpnet siden for deg." },
    ]);
    const reply = await chat.runChat(
      { kind: "store", store, market },
      { storeId, enabled: true, name: "Ingrid", occupation: "Kundeservice", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 },
      { market: market.slug, path: `/s/${slug}/no`, messages: [{ role: "user", content: "Har dere lamper?" }], signals: { views: [], searches: [] } },
      connection,
    );
    expect(reply.reply).toBe("Her er bordlampen. Jeg har åpnet siden for deg.");
    expect(reply.actions).toEqual([{ type: "navigate", href: `/s/${slug}/no/p/demo-bordlampe`, label: expect.any(String) }]);
    expect(reply.products.map((p) => p.handle)).toContain("demo-bordlampe");
    const lamp = reply.products.find((p) => p.handle === "demo-bordlampe")!;
    expect(lamp.price.currency).toBe("NOK");

    // The model was given the rules, the tools, and the tools' results with the store's own prices.
    expect(String((sent[0].messages as Row[])[0].content)).toContain("Only help with Chat test");
    expect((sent[0].tools as Row[]).map((tool) => (tool.function as Row).name)).toContain("navigate");
    const results = (sent[1].messages as Row[]).filter((message) => message.role === "tool");
    expect(results).toHaveLength(2);
    expect(String(results[0].content)).toMatch(/demo-bordlampe.*kr/);
  });

  it("shows the store's campaigns on the cards it draws, and gives the model only the offers the site words (D115)", async () => {
    const market = store.markets.find((m) => m.code === "NO")!;
    const [lamp] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
    const [gift] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-NOTEBOOK-LINED'`);
    await db().execute(sql`insert into commerce.campaigns (store_id, name, kind, percent) values (${storeId}::uuid, 'Høstsalg', 'percent', 20)`);
    await db().execute(sql`insert into commerce.campaigns (store_id, name, kind, buy_quantity, pay_quantity, product_ids) values (${storeId}::uuid, 'Lamper tre for to', 'multi_buy', 3, 2, ${JSON.stringify([String(lamp.id)])}::jsonb)`);
    await db().execute(sql`insert into commerce.campaigns (store_id, name, kind, gift_variant_id, thresholds, per_customer_limit) values (${storeId}::uuid, 'Gratis notatbok', 'gift', ${String(gift.id)}::uuid, '{"NO": 50000}'::jsonb, 1)`);
    // One for chosen customer groups is not told to anyone: the cards are the same for every visitor.
    const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Grossist', 10) returning id`);
    await db().execute(sql`insert into commerce.campaigns (store_id, name, kind, percent, tier_ids) values (${storeId}::uuid, 'Kun grossist', 'percent', 60, ${JSON.stringify([String(tier.id)])}::jsonb)`);
    const sent = fakeModel([
      { content: null, tool_calls: [call("1", "search_products", { query: "bordlampe" }), call("2", "get_product", { handle: "demo-bordlampe" })] },
      { content: "Bordlampen er på tilbud." },
    ]);
    const reply = await chat.runChat(
      { kind: "store", store, market },
      { storeId, enabled: true, name: "Ingrid", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 },
      { market: market.slug, path: `/s/${slug}/no`, messages: [{ role: "user", content: "Er det noe tilbud på lamper?" }], signals: { views: [], searches: [] } },
      connection,
    );
    // Two offers at most on a card, never a gift, never the group's.
    const card = reply.products.find((p) => p.handle === "demo-bordlampe")!;
    expect(card.offers).toEqual(["20 % rabatt", "3 for 2"]);
    const results = (sent[1].messages as Row[]).filter((message) => message.role === "tool").map((message) => String(message.content));
    expect(results[0]).toContain("Høstsalg: 20 % rabatt");
    // The page of one product tells the gift too, and that it needs a sign-in; and no one hears of the group's.
    expect(results[1]).toContain("Lamper tre for to: 3 for 2");
    expect(results[1]).toMatch(/Gratis notatbok: Gratis .* når du handler for 500,00\skr\s\(Logg inn på Min konto for å få det\.\)/);
    expect(results[1]).toContain("taken off in the cart");
    expect(results.join(" ")).not.toContain("Kun grossist");
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
  });

  it("tells the model the store's return policy from its settings, and the legal default when it has set none (D153)", async () => {
    const market = store.markets.find((m) => m.code === "NO")!;
    const agent = { storeId, enabled: true, name: "Ingrid", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 };
    const info = async (forStore: Store) => {
      const sent = fakeModel([{ content: null, tool_calls: [call("1", "store_info", {})] }, { content: "Se siden for å angre kjøpet." }]);
      await chat.runChat({ kind: "store", store: forStore, market }, agent, { market: market.slug, path: `/s/${slug}/no`, messages: [{ role: "user", content: "Kan jeg returnere?" }], signals: { views: [], searches: [] } }, connection);
      const result = (sent[1].messages as Row[]).find((message) => message.role === "tool");
      return JSON.parse(String(result!.content)) as { returns: Record<string, unknown> };
    };
    expect((await info(store)).returns).toEqual({
      legalRightToWithdrawDays: 14,
      storeReturnWindowDays: 14,
      returnShippingPaidBy: "the customer",
      takesBackGoodsTheLawExcludes: false,
      withdrawFromContractPage: `/s/${slug}/no/withdraw`,
      note: expect.stringContaining("faulty goods are a separate matter"),
    });
    await db().execute(sql`insert into commerce.return_settings (store_id, window_days, who_pays_return, accept_excluded) values (${storeId}::uuid, 45, 'store', true)`);
    const own = (await getStore(slug))!;
    expect((await info(own)).returns).toMatchObject({ storeReturnWindowDays: 45, returnShippingPaidBy: "the store", takesBackGoodsTheLawExcludes: true, legalRightToWithdrawDays: 14 });
    await db().execute(sql`delete from commerce.return_settings where store_id = ${storeId}::uuid`);
  });

  it("recommends through the store's recommendation engine, which it uses only while the store has it on (D139)", async () => {
    const market = store.markets.find((m) => m.code === "NO")!;
    const agent = { storeId, enabled: true, name: "Ingrid", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 };
    const ask = (steps: Row[]) => {
      const sent = fakeModel(steps);
      return {
        sent,
        reply: chat.runChat(
          { kind: "store", store, market },
          agent,
          { market: market.slug, path: `/s/${slug}/no/p/demo-bordlampe`, messages: [{ role: "user", content: "Hva passer til lampen?" }], signals: { views: [], searches: [] } },
          connection,
        ),
      };
    };
    // Off: the agent is told to search instead.
    let asked = ask([{ content: null, tool_calls: [call("1", "recommend_products", {})] }, { content: "Jeg søker i stedet." }]);
    await asked.reply;
    expect(String((asked.sent[1].messages as Row[]).filter((m) => m.role === "tool")[0].content)).toContain("recommendations are off");

    // On: the page the visitor is on names the product; the engine's picks come back as cards and facts for the model.
    await db().execute(sql`insert into commerce.recommendation_settings (store_id, enabled, ai) values (${storeId}::uuid, true, false)`);
    try {
      asked = ask([{ content: null, tool_calls: [call("1", "recommend_products", {})] }, { content: "Disse passer godt til lampen." }]);
      const reply = await asked.reply;
      const result = JSON.parse(String((asked.sent[1].messages as Row[]).filter((m) => m.role === "tool")[0].content)) as { products: { handle: string; relation: string }[]; note: string };
      expect(result.products.length).toBeGreaterThan(0);
      expect(result.products.map((p) => p.handle)).not.toContain("demo-bordlampe");
      expect(result.note).toContain("Do not add other products");
      expect(reply.products.map((p) => p.handle)).toEqual(result.products.map((p) => p.handle));
      expect((asked.sent[0].tools as Row[]).map((tool) => (tool.function as Row).name)).toContain("recommend_products");
    } finally {
      await db().execute(sql`delete from commerce.recommendation_settings where store_id = ${storeId}::uuid`);
    }
  });

  it("opens only the store's own pages", async () => {
    const market = store.markets.find((m) => m.code === "NO")!;
    const sent = fakeModel([
      { content: null, tool_calls: [call("1", "navigate", { to: "product", handle: "no-such-thing" }), call("2", "navigate", { to: "https://evil.example" })] },
      { content: "Jeg fant den ikke." },
    ]);
    const reply = await chat.runChat(
      { kind: "store", store, market },
      { storeId, enabled: true, name: "Ingrid", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 },
      { messages: [{ role: "user", content: "Vis meg noe" }], signals: { views: [], searches: [] } },
      connection,
    );
    expect(reply.actions).toEqual([]);
    const results = (sent[1].messages as Row[]).filter((message) => message.role === "tool").map((message) => String(message.content));
    expect(results[0]).toContain("No product");
    expect(results[1]).toContain("cannot open");
  });

  it("answers after a few rounds of tools however many the model asks for", async () => {
    const market = store.markets[0];
    const loop = Array.from({ length: 10 }, (_, i) => ({ content: null, tool_calls: [call(String(i), "store_info", {})] }));
    const sent = fakeModel([...loop.slice(0, 4), { content: "Butikken heter Chat test." }]);
    const reply = await chat.runChat(
      { kind: "store", store, market },
      { storeId, enabled: true, name: "Ingrid", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 },
      { messages: [{ role: "user", content: "Hva heter dere?" }], signals: { views: [], searches: [] } },
      connection,
    );
    expect(reply.reply).toBe("Butikken heter Chat test.");
    expect(sent).toHaveLength(5);
    // The last round offers no tools.
    expect(sent[4].tools).toEqual([]);
  });
});
