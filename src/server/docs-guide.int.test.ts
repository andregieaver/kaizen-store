import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { GuideTurnAnswer } from "@/lib/docs-guide-shape";
import { unframe } from "@/lib/prompt-safety";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));
// A reader of the docs is not signed in.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

/**
 * The model is a stand-in: it reads the conversation's last message and the tools' answers so far, and asks for tools as the test wants; the
 * tools themselves run for real against the database's docs index (written from the repository's articles and contracts) and the docs.
 */
const model = vi.hoisted(() => ({ on: true, seen: [] as { messages: { role: string; content: string | null }[]; tools: string[] }[] }));
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  const connection = { provider: "openai", source: "platform", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null, minSimilarity: 0.5 };
  return {
    ...real,
    aiFor: async (storeId: string | null, ...rest: unknown[]) => (storeId === null && model.on ? (connection as never) : (real.aiFor as (...args: unknown[]) => unknown)(storeId, ...rest)),
    chatWithTools: async (_connection: unknown, messages: { role: string; content: string | null }[], tools: { name: string }[]) => {
      model.seen.push({ messages: messages.map((m) => ({ role: m.role, content: m.content })), tools: tools.map((t) => t.name) });
      const said = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const results = messages.slice(messages.findLastIndex((m) => m.role === "user")).filter((m) => m.role === "tool").map((m) => JSON.parse(unframe(String(m.content))) as Record<string, unknown>);
      const call = (name: string, args: unknown) => ({ content: null, toolCalls: [{ id: `c${model.seen.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
      if (said.startsWith("How do I create my store")) {
        if (results.length === 0) return call("search_docs", { query: "create your store", track: "owners" });
        if (results.length === 1) return call("read_doc", { page: (results[0].results as { page: string }[])[0].page });
        return { content: "Sign up, then **follow the setup steps** in the admin. See [the page](https://evil.example/x).", toolCalls: [] };
      }
      if (said.startsWith("Can I pay my plan in bitcoin")) {
        if (results.length === 0) return call("search_docs", { query: "pay plan bitcoin" });
        if (results.length === 1) return call("offer_support", { topic: `pay plan in bitcoin ${run}` });
        return { content: "The docs do not cover that.", toolCalls: [] };
      }
      if (said.startsWith("Open the page about tokens")) {
        if (results.length === 0) return call("navigate", { to: "docs", page: "developers/overview/authentication" });
        if (results.length === 1) return call("navigate", { to: "admin", path: "/admin/{store}/settings/api" });
        return { content: "I opened the page about tokens.", toolCalls: [] };
      }
      if (said.startsWith("What does products.get answer")) {
        if (results.length === 0) return call("api_operation", { operation: "products.get" });
        if (results.length === 1) return call("webhook_topic", { topic: "order.paid" });
        if (results.length === 2) return call("mcp_tool", { name: "list_products" });
        return { content: "One product with its variants and prices.", toolCalls: [] };
      }
      return { content: "Ask me about the docs.", toolCalls: [] };
    },
  };
});

const run = Date.now().toString(36);
const { GET, POST } = await import("@/app/api/docs/guide/route");
const { guidePromptVersion } = await import("./prompt-versions");

let visitor = 0;
const headersFrom = (more: Record<string, string> = {}) => ({ host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": `198.51.100.${(visitor++ % 250) + 1}-${run}`, ...more });
const post = (body: unknown, more: Record<string, string> = {}) =>
  POST(new Request("http://localhost:3000/api/docs/guide", { method: "POST", headers: headersFrom(more), body: JSON.stringify(body) }));
const answer = async (response: Response) => {
  expect(response.status).toBe(200);
  return (await response.json()) as GuideTurnAnswer;
};

beforeAll(async () => {
  await db().execute(sql`insert into commerce.docs_guide (id, enabled, name, daily_limit) values (1, true, 'Ada', 1000) on conflict (id) do update set enabled = true, name = 'Ada', daily_limit = 1000`);
});

beforeEach(() => {
  model.on = true;
  model.seen = [];
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.docs_guide`);
  await db().execute(sql`delete from commerce.docs_guide_conversations`);
  await db().execute(sql`delete from commerce.docs_search_misses where query like ${`%${run}%`}`);
  await db().execute(sql`delete from commerce.chat_usage where store_id is null and (bucket like 'guide:%' or bucket like 'budget:docs_guide%' or bucket like 'docs_guide_miss:%')`);
  await closeDb();
});

describe("the docs guide's route and tools (D444)", () => {
  it("answers from the docs: searches, reads the page, links it, and shows its words as text without other sites' addresses", async () => {
    const first = await answer(await post({ message: "How do I create my store?", lang: "en", page: "owners/getting-started/create-your-store" }));
    expect(first.conversation.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.messages.map((m) => m.author)).toEqual(["reader", "ai"]);
    const reply = first.messages[1];
    expect(reply.body).toBe("Sign up, then follow the setup steps in the admin. See the page.");
    expect(reply.links).toEqual([{ title: "Create your store", href: "/docs/owners/getting-started/create-your-store" }]);
    // The model was offered the guide's tools alone, and its answer is kept with the prompt's version (D391), never shown to the reader.
    expect(model.seen[0].tools).toEqual(["search_docs", "read_doc", "api_operation", "webhook_topic", "mcp_tool", "navigate", "offer_support"]);
    const [kept] = await db().execute<Row>(sql`select data from commerce.docs_guide_messages where conversation_id = ${first.conversation.id}::uuid and author = 'ai'`);
    expect((kept.data as Record<string, unknown>).prompt).toBe(guidePromptVersion());
    expect(JSON.stringify(first)).not.toContain(guidePromptVersion());

    // The tab goes on with its reference and what it last saw; the model reads the conversation from the database.
    const ref = { id: first.conversation.id, token: first.conversation.token! };
    const next = await answer(await post({ message: "Thanks!", lang: "en", conversation: ref, after: 2 }));
    expect(next.conversation).toEqual({ id: ref.id });
    expect(next.messages.map((m) => [m.seq, m.author])).toEqual([[3, "reader"], [4, "ai"]]);
    const history = model.seen.at(-1)!.messages.filter((m) => m.role !== "system").map((m) => m.role);
    expect(history).toEqual(["user", "assistant", "user"]);
    // Another tab's token starts a new conversation rather than reading this one.
    const stranger = await answer(await post({ message: "Thanks!", lang: "en", conversation: { id: ref.id, token: "x".repeat(32) } }));
    expect(stranger.conversation.id).not.toBe(ref.id);
  });

  it("takes a token out of the reader's message before it is kept or reaches the AI, and says so", async () => {
    const token = "kf_3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c";
    const said = await answer(await post({ message: `Ask me: my token ${token} fails`, lang: "en" }));
    expect(said.removedSecret).toBe(true);
    expect(said.messages[0].body).toBe("Ask me: my token ••• fails");
    expect(JSON.stringify(model.seen)).not.toContain(token);
    const stored = await db().execute<Row>(sql`select body from commerce.docs_guide_messages where conversation_id = ${said.conversation.id}::uuid`);
    expect(JSON.stringify(stored)).not.toContain("kf_3f9a");
  });

  it("offers Kaizena Flow's support when the docs do not cover a question, and counts it for the docs' gap list", async () => {
    const said = await answer(await post({ message: "Can I pay my plan in bitcoin?", lang: "en" }));
    const reply = said.messages.at(-1)!;
    expect(reply.support).toEqual({ admin: "/admin/account/kaizen-support", email: expect.toBeOneOf([null, expect.any(String)]) });
    // The search found nothing whose words all matched, and support was offered: no links pretend the docs answered.
    expect(reply.links).toBeUndefined();
    const [miss] = await db().execute<Row>(sql`select misses, guide_misses from commerce.docs_search_misses where query = ${`pay plan in bitcoin ${run}`} and lang = 'en'`);
    expect(miss).toEqual({ misses: 0, guide_misses: 1 });
    const [conversation] = await db().execute<Row>(sql`select unanswered from commerce.docs_guide_conversations where id = ${said.conversation.id}::uuid`);
    expect(conversation.unanswered).toBe(1);
  });

  it("opens a docs page, and refuses the admin for a reader who is not signed in", async () => {
    const said = await answer(await post({ message: "Open the page about tokens", lang: "en" }));
    expect(said.messages.at(-1)!.action).toEqual({ type: "navigate", href: "/docs/developers/overview/authentication", label: "Authentication, scopes and limits" });
    const toolAnswers = model.seen.at(-1)!.messages.filter((m) => m.role === "tool").map((m) => unframe(String(m.content)));
    expect(toolAnswers[1]).toContain("not signed in");
  });

  it("looks an operation, a topic and a tool up from the contracts and links their reference pages", async () => {
    const said = await answer(await post({ message: "What does products.get answer?", lang: "en" }));
    const hrefs = said.messages.at(-1)!.links!.map((l) => l.href);
    expect(hrefs).toHaveLength(3);
    expect(hrefs[0]).toMatch(/^\/docs\/reference\/admin-api\/[a-z-]+#products-get$/);
    expect(hrefs[1]).toMatch(/^\/docs\/reference\/webhooks\//);
    expect(hrefs[2]).toMatch(/^\/docs\/reference\/mcp\/[a-z-]+#list-products$/);
  });

  it("refuses another site, a message it cannot read, a guide that is off, and a reader or a day past the limits", async () => {
    expect((await post({ message: "Hi", lang: "en" }, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await post({ message: "", lang: "en" })).status).toBe(400);
    expect((await post({ message: "Hei", lang: "sv" })).status).toBe(400);
    model.on = false;
    expect((await post({ message: "Hi", lang: "en" })).status).toBe(404);
    model.on = true;
    await db().execute(sql`update commerce.docs_guide set enabled = false`);
    const off = await post({ message: "Hi", lang: "nb" });
    expect(off.status).toBe(404);
    expect(((await off.json()) as { error: string }).error).toBe("KI-veilederen svarer ikke akkurat nå. Søk i dokumentasjonen, eller kontakt Kaizena Flows kundestøtte.");
    await db().execute(sql`update commerce.docs_guide set enabled = true, daily_limit = 1`);
    await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket = 'guide:day'`);
    expect((await post({ message: "Hi", lang: "en" })).status).toBe(200);
    const closed = await post({ message: "Hi again", lang: "en" });
    expect(closed.status).toBe(429);
    expect(((await closed.json()) as { error: string }).error).toBe("The guide has answered all it can for today. Search the docs, or try again tomorrow.");
    // The platform chat's own day is not the guide's.
    const [platform] = await db().execute<Row>(sql`select count(*)::int as n from commerce.chat_usage where store_id is null and bucket = 'day' and count > 1000000`);
    expect(platform.n).toBe(0);
    await db().execute(sql`update commerce.docs_guide set daily_limit = 1000`);
    await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket = 'guide:day'`);
    // One reader's budget a minute (docs_guide) stops a flood before any model is asked.
    const flood = headersFrom();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await POST(new Request("http://localhost:3000/api/docs/guide", { method: "POST", headers: flood, body: JSON.stringify({ message: "Hi", lang: "en" }) }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("tells the docs' panel whether it answers, who answers, how long it keeps a conversation and that the AI only answers", async () => {
    const profile = await (await GET(new Request("http://localhost:3000/api/docs/guide?lang=en"))).json();
    expect(profile).toEqual({ on: true, name: "Ada", occupation: "", avatar: null, avatarStyle: null, greeting: "", keptDays: expect.any(Number), aiUse: { tone: false, summaries: false } });
    model.on = false;
    expect((await (await GET(new Request("http://localhost:3000/api/docs/guide?lang=nb"))).json()).on).toBe(false);
  });
});
