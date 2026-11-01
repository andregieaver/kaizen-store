import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Work registered with `after()` runs when the test says, as it would once the response is sent. */
const later: (() => Promise<unknown>)[] = [];
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: (task: () => Promise<unknown>) => later.push(task) }));

/** The turn itself is a stand-in: what matters here is what the route gives it and keeps alive. */
const seen: { aborted: boolean[]; finished: number; hold: number } = { aborted: [], finished: 0, hold: 50 };
vi.mock("./owner-assistant", async (importOriginal) => {
  const real = await importOriginal<typeof import("./owner-assistant")>();
  return {
    ...real,
    runTurn: async (input: { signal?: AbortSignal; emit: (e: unknown) => void }) => {
      // A long turn ends early when its signal is aborted, as the real one does at its next check.
      const until = Date.now() + seen.hold;
      while (Date.now() < until && !input.signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 25));
      seen.aborted.push(input.signal?.aborted ?? false);
      input.emit({ type: "done", message: { id: "m", role: "assistant", content: "Done.", tools: [], feedback: null, createdAt: new Date().toISOString() } });
      seen.finished += 1;
    },
  };
});

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const { requestStop, stopRequestedSince } = await import("./assistant-stop");
const { assistantTurn } = await import("./assistant-route");
const { recentAdminConversation } = await import("./store-mcp");

type Row = Record<string, unknown>;

/**
 * The AI manager's turn and the page (PSI AGT-03): a page that closes or loses its connection no longer stops the turn, which finishes
 * and is kept; Stop, pressed on purpose, marks the person's own conversation, and only that stops it. And Kaizen Life going on in the
 * owner's admin conversation (PSI AGT-13).
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;

const conversation = async (accountId: string, source: "admin" | "kaizen-life" = "admin", hoursAgo = 0) =>
  String(
    (
      await db().execute<Row>(sql`
        insert into commerce.assistant_conversations (store_id, account_id, title, source, updated_at)
        values (${store.id}::uuid, ${accountId}::uuid, 'T', ${source}, now() - make_interval(hours => ${hoursAgo})) returning id`)
    )[0].id,
  );

beforeAll(async () => {
  store = await makeStore("assistant-stop");
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.id}::uuid`);
  owner = await membershipOf(store.slug, store.account, "owner");
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("Stop, pressed on purpose", () => {
  it("marks only the person's own admin conversation, and is read as after the turn began", async () => {
    const mine = await conversation(store.account.id);
    const other = await makeAccount("assistant-stop-other");
    const theirs = await conversation(other.id);
    const began = new Date(Date.now() - 1000);
    expect(await stopRequestedSince(mine, began)).toBe(false);
    expect(await requestStop(owner, theirs)).toBe(false);
    expect(await requestStop(owner, mine)).toBe(true);
    expect(await stopRequestedSince(mine, began)).toBe(true);
    // A turn begun after the press is not stopped by it.
    expect(await stopRequestedSince(mine, new Date(Date.now() + 60_000))).toBe(false);
  });
});

describe("a turn whose page goes away", () => {
  it("is not stopped by the lost connection: it finishes and is kept, kept alive by after()", async () => {
    const id = await conversation(store.account.id);
    const page = new AbortController();
    const request = new Request("http://localhost/admin/x/assistant/turn", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({ conversationId: id, message: "Hvor mange ordrer venter?" }),
      signal: page.signal,
    });
    const response = await assistantTurn(request, owner);
    expect(response.status).toBe(200);
    // The person closes the page at once.
    page.abort();
    const before = seen.finished;
    for (const task of later.splice(0)) await task();
    expect(seen.finished).toBe(before + 1);
    expect(seen.aborted.at(-1)).toBe(false);
  });
});

describe("a turn stopped on purpose", () => {
  it("is aborted at the route's next look at the mark, the page still open", async () => {
    const id = await conversation(store.account.id);
    seen.hold = 6000;
    try {
      const request = new Request("http://localhost/admin/x/assistant/turn", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
        body: JSON.stringify({ conversationId: id, message: "Skriv en lang tekst." }),
      });
      await assistantTurn(request, owner);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await requestStop(owner, id)).toBe(true);
      const started = Date.now();
      for (const task of later.splice(0)) await task();
      expect(seen.aborted.at(-1)).toBe(true);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      seen.hold = 50;
    }
  });
});

describe("Kaizen Life going on in the owner's admin conversation", () => {
  it("finds the owner's latest admin conversation of the last day, never Kaizen Life's own or an old one", async () => {
    const fresh = await makeStore("assistant-resume");
    const freshOwner = await membershipOf(fresh.slug, fresh.account, "owner");
    const make = async (source: "admin" | "kaizen-life", hoursAgo: number) =>
      String(
        (
          await db().execute<Row>(sql`
            insert into commerce.assistant_conversations (store_id, account_id, title, source, updated_at)
            values (${fresh.id}::uuid, ${fresh.account.id}::uuid, 'T', ${source}, now() - make_interval(hours => ${hoursAgo})) returning id`)
        )[0].id,
      );
    await make("admin", 30);
    expect(await recentAdminConversation(freshOwner)).toBeNull();
    const recent = await make("admin", 2);
    await make("kaizen-life", 0);
    expect(await recentAdminConversation(freshOwner)).toBe(recent);
  });
});
