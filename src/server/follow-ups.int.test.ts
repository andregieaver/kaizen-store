import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const { runManagerTool } = await import("./manager-tools");
const { runFollowUps } = await import("./follow-up-runner");
type TurnInput = import("./owner-assistant").TurnInput;
type OutgoingEmail = import("./email").OutgoingEmail;

type Row = Record<string, unknown>;

/**
 * The AI manager's follow-ups (PSI AGT-04, AGT-11): kept, listed and cancelled by its tools in the person's own store, and given back
 * to it at their time by the runner, as a turn in the person's name, with nobody there to say yes, and an email saying where to read it.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let conversation: string;

const ctxFor = async (account: { id: string; email: string; name: string | null; platformAdmin: boolean }, extra: Record<string, unknown> = {}) => ({
  account,
  store: (await getStore(store.slug))!,
  flags: {},
  connection: null,
  navigate: () => {},
  invalidate: () => {},
  turn: { conversationId: conversation, said: "Remind me", startedAt: new Date(), decide: async () => null },
  ...extra,
});

const keep = async (args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  (await runManagerTool((await ctxFor(store.account, extra)) as never, "follow_up", args)) as { id: string; done: string };

const rowOf = async (id: string) => (await db().execute<Row>(sql`select * from commerce.assistant_follow_ups where id = ${id}::uuid`))[0];
const makeDue = (id: string) => db().execute(sql`update commerce.assistant_follow_ups set due_at = now() - interval '1 minute', claimed_until = null where id = ${id}::uuid`);

/** A turn that answers, or fails as `runTurn()` reports a failure, and remembers what it was given. */
const turns: TurnInput[] = [];
const answering = (events: ("approval" | "error")[] = []) => async (input: TurnInput) => {
  turns.push(input);
  for (const kind of events) {
    if (kind === "error") input.emit({ type: "error", message: "The AI did not answer: busy" });
    if (kind === "approval") input.emit({ type: "approval", approval: { id: "a", tool: "refund_order", summary: "Refund", category: "spend", status: "pending", outcome: null, createdAt: "" } });
  }
  input.emit({ type: "done", message: { id: "m", role: "assistant", content: "Order 1042 was sent yesterday to Kari Nordmann.", tools: [], feedback: null, createdAt: "" } });
};
const emails: OutgoingEmail[] = [];
const send = async (message: OutgoingEmail) => {
  emails.push(message);
  return "logged" as const;
};

beforeAll(async () => {
  store = await makeStore("followup");
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_conversations (store_id, account_id, title) values (${store.id}::uuid, ${store.account.id}::uuid, 'Follow-ups') returning id
  `);
  conversation = String(row.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_follow_ups where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the follow-up tools", () => {
  it("keeps one in the person's conversation, lists it and cancels it", async () => {
    const kept = await keep({ task: "Check whether order 1042 was sent", in_hours: 2 });
    expect(kept.done).toContain("Kept: you will follow up");
    const row = await rowOf(kept.id);
    expect(row).toMatchObject({ status: "waiting", repeat: "none", conversation_id: conversation, store_id: store.id, time_zone: expect.any(String) });

    const ctx = await ctxFor(store.account);
    const listed = (await runManagerTool(ctx as never, "list_follow_ups", {})) as { follow_ups: { id: string; task: string }[] };
    expect(listed.follow_ups.map((f) => f.id)).toContain(kept.id);

    expect(await runManagerTool(ctx as never, "cancel_follow_up", { follow_up: kept.id })).toEqual({ done: "Cancelled." });
    await expect(runManagerTool(ctx as never, "cancel_follow_up", { follow_up: kept.id })).rejects.toThrow(/no such follow-up/);
  });

  it("refuses a bad time, another's follow-up, and one set by a follow-up", async () => {
    await expect(keep({ task: "Look again", at: "someday" })).rejects.toThrow(/YYYY-MM-DD HH:MM/);
    await expect(keep({ task: "Look again", in_hours: 1 }, { scheduled: true })).rejects.toThrow(/cannot set another/);
    const kept = await keep({ task: "Look again", in_hours: 3 });
    const stranger = await makeAccount("stranger");
    await addMember(store.id, stranger.id, "admin");
    await expect(runManagerTool((await ctxFor(stranger)) as never, "cancel_follow_up", { follow_up: kept.id })).rejects.toThrow(/no such follow-up/);
    await db().execute(sql`update commerce.assistant_follow_ups set status = 'cancelled' where id = ${kept.id}::uuid`);
  });

  it("never decides a waiting change in a follow-up's turn", async () => {
    const ctx = await ctxFor(store.account, { scheduled: true });
    await expect(runManagerTool(ctx as never, "decide_approval", { approval: "11111111-1111-4111-8111-111111111111", approve: true })).rejects.toThrow(/not here/);
  });

  it("holds the number waiting to the limit", async () => {
    const busy = await makeAccount("busy");
    await addMember(store.id, busy.id, "owner");
    await db().execute(sql`
      insert into commerce.assistant_follow_ups (store_id, account_id, conversation_id, task, due_at, time_zone)
      select ${store.id}::uuid, ${busy.id}::uuid, ${conversation}::uuid, 'x', now() + interval '1 day', 'Europe/Oslo' from generate_series(1, 20)
    `);
    await expect(runManagerTool((await ctxFor(busy)) as never, "follow_up", { task: "One more", in_hours: 1 })).rejects.toThrow(/already have 20/);
    await db().execute(sql`delete from commerce.assistant_follow_ups where account_id = ${busy.id}::uuid`);
  });
});

describe("the runner", () => {
  it("gives a due one back as a turn in the person's name, with nobody there, and emails where to read it", async () => {
    const { id } = await keep({ task: "Check whether order 1042 was sent", in_hours: 1 });
    await makeDue(id);
    turns.length = 0;
    emails.length = 0;
    const run = await runFollowUps({ turn: answering(["approval"]), send });
    expect(run.answered).toBe(1);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ conversationId: conversation, scheduled: true });
    expect(turns[0].member.account.id).toBe(store.account.id);
    expect(turns[0].member.store?.slug).toBe(store.slug);
    expect(turns[0].member.role).toBe("owner");
    expect(turns[0].message).toContain("Check whether order 1042 was sent");

    expect(await rowOf(id)).toMatchObject({ status: "done", runs: 1, tries: 0, claimed_until: null });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ kind: "assistant.follow_up", to: store.account.email, storeId: store.id });
    expect(emails[0].email.html).toContain(`/admin/${store.slug}/assistant?c=${conversation}`);
    expect(emails[0].email.text).toContain("A change is waiting for your yes there.");
    // The answer stays in the admin.
    expect(emails[0].email.text).not.toContain("Kari Nordmann");
  });

  it("moves a repeating one to its next time", async () => {
    const { id } = await keep({ task: "Tell me what needs a look", in_hours: 1, repeat: "weekly" });
    await makeDue(id);
    emails.length = 0;
    await runFollowUps({ turn: answering(), send });
    const row = await rowOf(id);
    expect(row.status).toBe("waiting");
    expect(new Date(String(row.due_at)).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(emails[0].email.text).toContain("It follows up again");
    await db().execute(sql`update commerce.assistant_follow_ups set status = 'cancelled' where id = ${id}::uuid`);
  });

  it("tries a failing one again, then stops and says so", async () => {
    const { id } = await keep({ task: "Check the stock", in_hours: 1 });
    emails.length = 0;
    for (let i = 0; i < 2; i++) {
      await makeDue(id);
      expect((await runFollowUps({ turn: answering(["error"]), send })).retried).toBe(1);
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: "waiting", tries: i + 1, last_problem: "The AI did not answer: busy" });
      expect(new Date(String(row.due_at)).getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
    }
    expect(emails).toHaveLength(0);
    await makeDue(id);
    expect((await runFollowUps({ turn: answering(["error"]), send })).failed).toBe(1);
    expect((await rowOf(id)).status).toBe("failed");
    expect(emails[0].email.subject).toContain("could not follow up");
  });

  it("cancels one whose person is no longer a member, without a turn", async () => {
    const leaver = await makeAccount("leaver");
    await addMember(store.id, leaver.id, "admin");
    const { id } = (await runManagerTool((await ctxFor(leaver)) as never, "follow_up", { task: "Look again", in_hours: 1 })) as { id: string };
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${leaver.id}::uuid`);
    await makeDue(id);
    turns.length = 0;
    expect((await runFollowUps({ turn: answering(), send })).cancelled).toBe(1);
    expect(turns).toHaveLength(0);
    expect((await rowOf(id)).status).toBe("cancelled");
  });
});
