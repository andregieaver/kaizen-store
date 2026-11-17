import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { MASK, QUESTION_KEEP_DAYS } from "@/lib/unanswered-questions";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));
// Every test store has a text model and no embedding model (the stand-in answers through `fetch`), so the search is by keyword only.
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  const connection = { provider: "openai", source: "store", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null };
  return { ...real, aiFor: async () => connection as never };
});
vi.mock("./stripe", async (importOriginal) => ({ ...(await importOriginal<typeof import("./stripe")>()), platformStripe: () => ({}) }));

const { getStore } = await import("./stores");
const route = await import("./support-route");
const support = await import("./support");
const { systemDesk } = await import("./support-desk");
const questions = await import("./unanswered-questions");
const knowledge = await import("./knowledge");
const { RETENTION_STEPS, runRetention } = await import("./retention");
const { exportCustomerData } = await import("./privacy-export");
const { eraseSubject, planErasure } = await import("./privacy-erasure");
const { resolveSubject } = await import("./privacy-subject");
const { queueCounts } = await import("./attention");
type ChatContext = import("./chat-route").ChatContext;
type AiConnection = import("./ai").AiConnection;
type VisitorReply = import("@/lib/support-visitor").VisitorReply;
type Account = import("./auth").Account;

/**
 * Questions the chat assistant could not answer (ecosystem plan E4.3, D729), against a real database: a turn the AI handed to a person
 * because it could not help, or whose knowledge search found nothing, keeps the visitor's question (cut and masked) on the site's gap list;
 * repeats are one row; *Write the answer* saves a knowledge document the search then finds; *Not a question for the assistant* keeps it
 * set aside; another store's rows are never seen; erasure and retention take them. The model is a stand-in (`fetch`).
 */

const run = Date.now().toString(36);
const connection = { provider: "openai", source: "store", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null } as unknown as AiConnection;

type Site = { id: string; slug: string; owner: Account; ctx: (mode: "off" | "ai_first") => Promise<ChatContext> };

async function site(name: string): Promise<Site> {
  const slug = `uq-${name}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${id}::uuid`);
  const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  const store = (await getStore(slug))!;
  const market = store.markets.find((m) => m.code === "NO")!;
  return {
    id,
    slug,
    owner: { id: String(owner.id), email: String(owner.email), name: "Owner", platformAdmin: false } as Account,
    ctx: async (mode) => {
      await db().execute(sql`
        insert into commerce.support_settings (store_id, mode) values (${id}::uuid, ${mode})
        on conflict on constraint support_settings_store_key do update set mode = excluded.mode
      `);
      return {
        site: { kind: "store", store, market },
        storeId: id,
        lang: market.lang,
        locale: market.locale,
        market: market.slug,
        agent: { storeId: id, enabled: true, name: "Ingrid", occupation: "", avatar: null, avatarStyle: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 },
        connection,
        settings: await support.ensureDesk(systemDesk(id)),
      };
    },
  };
}

/** The model's answers in turn: a tool call (`[name, args]`) or words. */
function model(steps: ([string, Record<string, unknown>] | string)[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      const step = steps.shift() ?? "…";
      const message =
        typeof step === "string"
          ? { content: step }
          : { content: null, tool_calls: [{ id: `c${steps.length}`, type: "function", function: { name: step[0], arguments: JSON.stringify(step[1]) } }] };
      return Response.json({ choices: [{ message }] });
    }),
  );
}

const say = async (ctx: ChatContext, message: string, ref?: { id: string; token: string }) => {
  const answer = await route.visitorTurn(ctx, { conversation: ref, after: 0, signals: { views: [], searches: [] } }, message);
  if (answer instanceof Response) throw new Error(`expected a reply, got ${answer.status}`);
  return answer as VisitorReply;
};
const refOf = (reply: VisitorReply) => ({ id: reply.conversation!.id, token: reply.conversation!.token! });
const handOver = (category: string): [string, Record<string, unknown>] => ["handoff_to_human", { reason: "Could not find it", category }];

let a: Site;
let b: Site;

beforeAll(async () => {
  a = await site("a");
  b = await site("b");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.unanswered_questions where store_id in (${a.id}::uuid, ${b.id}::uuid)`);
  await closeDb();
});

describe("gathering what the assistant could not answer", () => {
  it("keeps the question of a conversation the AI handed to a person because it could not help, cut and masked, with the conversation", async () => {
    const ctx = await a.ctx("ai_first");
    model([handOver("could_not_help"), "A person from the store will answer here."]);
    const reply = await say(ctx, "Do you offer gift wrapping? Mail me at kari@example.no or call 912 34 567");
    expect(reply.state.handler).toBe("queue");
    const [row] = await questions.listUnanswered(a.id);
    expect(row).toMatchObject({ question: `Do you offer gift wrapping? Mail me at ${MASK.email} or call ${MASK.number}`, lang: "nb", asked: 1, handedOver: 1, status: "open" });
    expect(row.conversations.map((c) => c.id)).toEqual([reply.conversation!.id]);
    // The words are kept nowhere else: no log line, no audit.
    const [audits] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${a.id}::uuid and details::text like '%gift wrapping%'`);
    expect(audits.n).toBe(0);
  });

  it("leaves out a hand-over for any other reason", async () => {
    const ctx = await a.ctx("ai_first");
    model([handOver("asked_for_person"), "A person will answer."]);
    await say(ctx, "I want to talk to a human about my parcel");
    expect((await questions.listUnanswered(a.id)).map((q) => q.question)).not.toContain("I want to talk to a human about my parcel");
  });

  it("keeps a question the knowledge search found nothing for, and not one it found something for or another tool answered", async () => {
    const ctx = await b.ctx("off");
    model([["search_content", { query: "loyalty card" }], "I do not know, sorry. Please contact the store."]);
    await say(ctx, "Do you have a loyalty card?");
    expect((await questions.listUnanswered(b.id)).map((q) => [q.question, q.handedOver])).toEqual([["Do you have a loyalty card?", 0]]);

    const saved = await knowledge.saveDocument(b.owner, b.id, null, { title: "Opening hours", content: "We are open from nine to five on weekdays." });
    expect(saved.ok).toBe(true);
    model([["search_content", { query: "opening hours" }], "We are open from nine to five."]);
    await say(ctx, "What are your opening hours?");
    // A search that found nothing, then a page the assistant opened: it stood on something.
    model([["search_content", { query: "parking spaces" }], ["navigate", { to: "home" }], "I opened the front page for you."]);
    await say(ctx, "Do you have parking spaces?");
    // A search with no words looks for nothing.
    model([["search_content", { query: "" }], "Hello!"]);
    await say(ctx, "Hello there friend");
    expect((await questions.listUnanswered(b.id)).map((q) => q.question)).toEqual(["Do you have a loyalty card?"]);
  });

  it("groups repeats in other case and marks, counts a conversation once, and keeps the newest words and conversations first", async () => {
    const ctx = await b.ctx("off");
    const first = (await questions.listUnanswered(b.id))[0];
    model([["search_content", { query: "loyalty" }], "Sorry, I do not know."]);
    const again = await say(ctx, "do you have a LOYALTY card");
    model([["search_content", { query: "loyalty" }], "Sorry, I do not know."]);
    await say(ctx, "Do you have a loyalty card??", refOf(again));
    const [row] = await questions.listUnanswered(b.id);
    expect(row.id).toBe(first.id);
    expect(row.asked).toBe(2);
    expect(row.question).toBe("Do you have a loyalty card??");
    expect(row.conversations[0].id).toBe(again.conversation!.id);
    expect(row.conversations).toHaveLength(2);
  });
});

describe("answering and setting aside", () => {
  it("saves the answer as a knowledge document the search then finds, and the question is answered", async () => {
    const [row] = await questions.listUnanswered(b.id);
    expect(await questions.answerUnanswered(b.owner, b.id, row.id, { title: "", answer: "" })).toEqual({ ok: false, problem: "invalid" });
    const answered = await questions.answerUnanswered(b.owner, b.id, row.id, { title: "", answer: "Yes: every tenth coffee is free with our loyalty card." });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(await questions.listUnanswered(b.id)).toEqual([]);
    const [done] = await questions.listUnanswered(b.id, "answered");
    expect(done).toMatchObject({ id: row.id, status: "answered", documentId: answered.documentId });
    const found = await knowledge.searchKnowledge(b.id, "loyalty card", "nb-NO");
    expect(found.map((p) => [p.title, p.body])).toContainEqual(["Do you have a loyalty card??", "Yes: every tenth coffee is free with our loyalty card."]);
    // The chat now finds it, so the same question is not kept again.
    const ctx = await b.ctx("off");
    model([["search_content", { query: "loyalty card" }], "Yes: every tenth coffee is free."]);
    await say(ctx, "Do you have a loyalty card?");
    expect((await questions.listUnanswered(b.id, "answered"))[0].asked).toBe(2);
    expect(await questions.listUnanswered(b.id)).toEqual([]);
    // Audited with ids and counts, never the words.
    const [audit] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${b.id}::uuid and action = 'knowledge.question_answered'`);
    expect(audit.details).toMatchObject({ questionId: row.id, documentId: answered.documentId, asked: 2 });
    expect(JSON.stringify(audit.details)).not.toContain("loyalty");
  });

  it("puts an answered question back on the list when another conversation still cannot get it answered, and changes the same document", async () => {
    const ctx = await b.ctx("ai_first");
    model([handOver("could_not_help"), "A person will answer here."]);
    await say(ctx, "Do you have a loyalty card?");
    const [open] = await questions.listUnanswered(b.id);
    expect(open.status).toBe("open");
    expect(open.documentId).not.toBeNull();
    const [saved] = (await questions.savedAnswers(b.id, [open])).values();
    expect(saved.content).toContain("every tenth coffee");
    const again = await questions.answerUnanswered(b.owner, b.id, open.id, { title: "Loyalty card", answer: "Yes: the tenth coffee is free, ask at the till." });
    expect(again).toEqual({ ok: true, documentId: open.documentId });
    const documents = await knowledge.listDocuments(b.id);
    expect(documents.filter((d) => d.title === "Loyalty card")).toHaveLength(1);
  });

  it("keeps a dismissed question dismissed when it is asked again, and puts it back on request", async () => {
    const ctx = await a.ctx("ai_first");
    model([handOver("could_not_help"), "A person will answer here."]);
    await say(ctx, "What is the meaning of life?");
    const row = (await questions.listUnanswered(a.id)).find((q) => q.question === "What is the meaning of life?")!;
    expect(await questions.dismissUnanswered(a.owner, a.id, row.id)).toBe(true);
    expect(await questions.dismissUnanswered(a.owner, a.id, row.id)).toBe(false);
    model([handOver("could_not_help"), "A person will answer here."]);
    await say(ctx, "what is the meaning of life");
    const [dismissed] = await questions.listUnanswered(a.id, "dismissed");
    expect(dismissed).toMatchObject({ id: row.id, status: "dismissed", asked: 2 });
    expect((await questions.listUnanswered(a.id)).map((q) => q.id)).not.toContain(row.id);
    expect(await questions.restoreUnanswered(a.owner, a.id, row.id)).toBe(true);
    expect((await questions.listUnanswered(a.id)).map((q) => q.id)).toContain(row.id);
  });
});

describe("one site's questions", () => {
  it("are never seen, answered or changed from another site or the platform", async () => {
    const mine = await questions.listUnanswered(a.id);
    expect(mine.length).toBeGreaterThan(0);
    const id = mine[0].id;
    expect((await questions.listUnanswered(b.id)).map((q) => q.id)).not.toContain(id);
    expect((await questions.listUnanswered(null)).map((q) => q.id)).not.toContain(id);
    expect(await questions.getUnanswered(b.id, id)).toBeNull();
    expect(await questions.getUnanswered(null, id)).toBeNull();
    expect(await questions.answerUnanswered(b.owner, b.id, id, { title: "", answer: "Hijacked" })).toEqual({ ok: false, problem: "gone" });
    expect(await questions.dismissUnanswered(b.owner, b.id, id)).toBe(false);
    expect(await questions.dismissUnanswered(b.owner, null, id)).toBe(false);
    expect((await knowledge.listDocuments(b.id)).map((d) => d.title)).not.toContain("Do you offer gift wrapping?");
    // A conversation of another site is never listed with a question, even if its id were put there.
    const [theirs] = await db().execute<Row>(sql`select id from commerce.support_conversations where store_id = ${b.id}::uuid limit 1`);
    await db().execute(sql`update commerce.unanswered_questions set conversations = conversations || ${String(theirs.id)}::uuid where id = ${id}::uuid`);
    expect((await questions.listUnanswered(a.id)).find((q) => q.id === id)!.conversations.map((c) => c.id)).not.toContain(String(theirs.id));
  });

  it("are counted for Home's attention for the stores given, only open ones", async () => {
    const counts = await queueCounts({ disputes: [], decisions: [], leads: [], activities: [], comments: [], questions: [a.id, b.id] }, null);
    expect(counts.questions.get(a.id)).toBe((await questions.listUnanswered(a.id)).length);
    expect(await questions.openUnansweredCount(a.id)).toBe(counts.questions.get(a.id));
    expect((await queueCounts({ disputes: [], decisions: [], leads: [], activities: [], comments: [] }, null)).questions.size).toBe(0);
  });
});

describe("erasure, export and retention", () => {
  it("exports the question with the conversation its words came from, and erasure deletes it with the person's conversations", async () => {
    const ctx = await a.ctx("ai_first");
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${a.id}::uuid, ${`kari-${run}@example.com`}, 'Kari') returning id`);
    const customerId = String(customer.id);
    model([handOver("could_not_help"), "A person will answer here."]);
    const reply = await say(ctx, "Can I pay with an invoice from my company?");
    await support.claimForCustomer(systemDesk(a.id), reply.conversation!.id, customerId);

    const exported = await exportCustomerData(a.id, { customerId }, { channel: "staff", accountId: null });
    if (!exported.ok) throw new Error(exported.problem);
    const section = exported.file.sections.support as { questionsKept?: { question: string }[] }[];
    expect(section.flatMap((c) => c.questionsKept ?? []).map((q) => q.question)).toEqual(["Can I pay with an invoice from my company?"]);

    const plan = (await planErasure((await resolveSubject(a.id, { customerId }, { channel: "staff" }))!))!;
    expect(plan.plan.rows.find((r) => r.table === "unanswered_questions")).toMatchObject({ count: 1, action: "deleted" });

    const erased = await eraseSubject(a.id, { customerId }, { channel: "staff", accountId: null }, { avatarRemover: async () => {} });
    expect(erased).toMatchObject({ ok: true });
    expect((await questions.listUnanswered(a.id)).map((q) => q.question)).not.toContain("Can I pay with an invoice from my company?");
  });

  it("deletes a question the retention rule's days after it was last asked, whatever its state", async () => {
    const noSteps = Object.fromEntries(RETENTION_STEPS.filter((s) => s !== "unanswered_questions").map((s) => [s, async () => ({ count: 0 })]));
    const aged = async (key: string, lastDaysAgo: number, status: "open" | "dismissed") => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.unanswered_questions (store_id, lang, key, question, conversations, status, decided_at, first_at, last_at)
        values (${a.id}::uuid, 'nb', ${key}, ${key}, array[gen_random_uuid()], ${status}, ${status === "open" ? null : sql`now()`},
          now() - make_interval(days => ${QUESTION_KEEP_DAYS + 30}), now() - make_interval(days => ${lastDaysAgo}))
        returning id
      `);
      return String(row.id);
    };
    const old = await aged("old question", QUESTION_KEEP_DAYS + 1, "dismissed");
    const oldOpen = await aged("old open question", QUESTION_KEEP_DAYS + 1, "open");
    const young = await aged("young question", QUESTION_KEEP_DAYS - 1, "open");
    // Past its period a question is not shown even before the run.
    expect((await questions.listUnanswered(a.id)).map((q) => q.id)).not.toContain(oldOpen);
    const ran = await runRetention(new Date(), { steps: noSteps });
    expect(ran.counts.unanswered_questions).toBeGreaterThanOrEqual(2);
    const left = await db().execute<Row>(sql`select id from commerce.unanswered_questions where id in (${old}::uuid, ${oldOpen}::uuid, ${young}::uuid)`);
    expect(left.map((r) => String(r.id))).toEqual([young]);
  });
});
