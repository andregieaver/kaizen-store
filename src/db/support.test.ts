import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPPORT_MODES, type SupportMode } from "@/lib/support-rules";
import { nextState, type Actor, type ConversationState, type SupportEvent } from "@/lib/support-state";

import { createTestDatabase } from "./testing";

// What the database itself enforces for support (D216, docs/support.md 3.3).

let db: PGlite;
let store: string;
let agentA: string;
let agentB: string;
let counter = 0;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function refusal(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

async function setMode(mode: SupportMode, storeId: string | null = store) {
  await db.query(
    `insert into commerce.support_settings (store_id, mode) values ($1, $2)
     on conflict on constraint support_settings_store_key do update set mode = excluded.mode`,
    [storeId, mode],
  );
}

/** A new conversation on the store's desk, started as its mode says. */
async function conversation(mode: SupportMode, storeId: string | null = store): Promise<string> {
  await setMode(mode, storeId);
  counter += 1;
  const { id } = await one<{ id: string }>(
    `insert into commerce.support_conversations (store_id, source, handler, token_hash, locale)
     values ($1, 'site', $2, $3, 'en') returning id`,
    [storeId, mode === "people" ? "queue" : "ai", `hash-${counter}`],
  );
  return id;
}

/** Puts a conversation in a state directly, as only the transition function may. */
async function force(id: string, state: ConversationState) {
  await db.exec("begin");
  await db.query("select set_config('kaizen.support_transition', 'on', true)");
  await db.query("update commerce.support_conversations set status = $2, handler = $3, assignee_id = $4 where id = $1", [
    id,
    state.status,
    state.handler,
    state.assignee,
  ]);
  if (state.gone) await db.query("update commerce.support_conversations set anonymised_at = now() where id = $1", [id]);
  await db.exec("commit");
}

const add = (id: string, author: string, account: string | null, body: string, kind: string | null = null) =>
  db.query<{ id: string; seq: number }>("select * from commerce.support_add_message($1, $2, $3, $4, $5)", [id, author, account, body, kind]);

const transition = (id: string, event: string, actor: Actor, target: string | null = null, reason: string | null = null) =>
  one<{ handler: string }>("select commerce.support_transition($1, $2, $3, $4, $5, $6, $7) as handler", [
    id,
    event,
    actor.kind,
    actor.kind === "agent" ? actor.id : null,
    target,
    reason,
    "Kari",
  ]);

const stateOf = (id: string) =>
  one<{ status: string; handler: string; assignee_id: string | null }>(
    "select status, handler, assignee_id from commerce.support_conversations where id = $1",
    [id],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  store = (await one<{ id: string }>("insert into commerce.stores (slug, name) values ('support-store', 'Support store') returning id")).id;
  agentA = (await one<{ id: string }>("insert into commerce.accounts (email) values ('agent-a@example.com') returning id")).id;
  agentB = (await one<{ id: string }>("insert into commerce.accounts (email) values ('agent-b@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

describe("support in the database (D216)", () => {
  it("1. makes only the transitions of nextState(), by mode, with the same refusals and system lines", async () => {
    const states = (): ConversationState[] => [
      { status: "open", handler: "ai", assignee: null },
      { status: "open", handler: "queue", assignee: null },
      { status: "open", handler: "human", assignee: agentA },
      { status: "ended", handler: "ai", assignee: null },
      { status: "ended", handler: "human", assignee: null },
      { status: "ended", handler: "queue", assignee: null, gone: true },
    ];
    const actors = (): Actor[] => [{ kind: "customer" }, { kind: "ai" }, { kind: "system" }, { kind: "agent", id: agentA }, { kind: "agent", id: agentB }];
    const events: SupportEvent[] = ["handoff", "claim", "transfer", "hand_back", "end", "reopen"];
    let compared = 0;
    for (const mode of SUPPORT_MODES) {
      for (const state of states()) {
        for (const event of events) {
          for (const actor of actors()) {
            for (const target of event === "transfer" ? [null, agentA, agentB] : [null]) {
              const id = await conversation(mode);
              await force(id, state);
              const expected = nextState(state, event, actor, mode, target);
              const label = `${mode} ${state.status}/${state.handler}${state.gone ? "/gone" : ""} ${event} by ${actor.kind === "agent" ? (actor.id === agentA ? "A" : "B") : actor.kind} → ${target === agentA ? "A" : target === agentB ? "B" : "-"}`;
              const error = await refusal(transition(id, event, actor, target, event === "handoff" && actor.kind === "system" ? "tone" : null));
              if (!expected.ok) {
                expect(error, label).toBe(expected.refusal);
              } else {
                expect(error, label).toBeNull();
                const after = await stateOf(id);
                expect({ status: after.status, handler: after.handler, assignee: after.assignee_id }, label).toEqual({
                  status: expected.state.status,
                  handler: expected.state.handler,
                  assignee: expected.state.assignee,
                });
                const { rows } = await db.query<{ kind: string }>(
                  "select kind from commerce.support_messages where conversation_id = $1 and author = 'system' order by seq",
                  [id],
                );
                expect(rows.map((r) => r.kind), label).toEqual(expected.lines);
              }
              compared += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it("refuses a state change that does not go through the function, and a conversation that does not start as its mode says", async () => {
    const id = await conversation("ai_first");
    expect(await refusal(db.query("update commerce.support_conversations set handler = 'queue' where id = $1", [id]))).toBe("support_bad_event");
    await setMode("people");
    expect(
      await refusal(
        db.query("insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values ($1, 'site', 'ai', 'start-x', 'en')", [store]),
      ),
    ).toBe("support_bad_event");
  });

  it("2. drops a message from the AI after a person took over: no row, no number used", async () => {
    const id = await conversation("ai_first");
    await add(id, "customer", null, "Hello");
    expect((await add(id, "ai", null, "Hi! How can I help?")).rows[0].seq).toBe(2);
    await transition(id, "claim", { kind: "agent", id: agentA });
    expect((await add(id, "ai", null, "Late answer")).rows).toEqual([]);
    expect((await add(id, "agent", agentA, "Kari here.")).rows[0].seq).toBe(4);
    const { rows } = await db.query<{ author: string }>("select author from commerce.support_messages where conversation_id = $1 order by seq", [id]);
    expect(rows.map((r) => r.author)).toEqual(["customer", "ai", "system", "agent"]);
  });

  it("3. never stores a message from the AI on a desk of people only", async () => {
    const id = await conversation("people");
    await force(id, { status: "open", handler: "ai", assignee: null });
    expect(await refusal(add(id, "ai", null, "Hi"))).toBe("support_no_ai");
    // Mode `off` is the chat agent alone, as before: its conversations are kept with its answers.
    const off = await conversation("off");
    expect((await add(off, "ai", null, "Hi")).rows[0].seq).toBe(1);
  });

  it("4. lets only the first of two claims win", async () => {
    const id = await conversation("people");
    await transition(id, "claim", { kind: "agent", id: agentA });
    expect(await refusal(transition(id, "claim", { kind: "agent", id: agentB }))).toBe("support_taken");
    expect((await stateOf(id)).assignee_id).toBe(agentA);
  });

  it("5. numbers messages without gaps, and never changes one", async () => {
    const id = await conversation("ai_first");
    for (let i = 0; i < 5; i++) await add(id, i % 2 ? "ai" : "customer", null, `Message ${i}`);
    const { rows } = await db.query<{ seq: number }>("select seq from commerce.support_messages where conversation_id = $1 order by seq", [id]);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect((await one<{ message_seq: number }>("select message_seq from commerce.support_conversations where id = $1", [id])).message_seq).toBe(5);
    expect(await refusal(db.query("update commerce.support_messages set body = 'x' where conversation_id = $1", [id]))).toBe("support_bad_event");
    expect(
      await refusal(db.query("insert into commerce.support_messages (conversation_id, seq, author, body) values ($1, 6, 'customer', 'sneaky')", [id])),
    ).toBe("support_bad_event");
    await expect(
      db.query("update commerce.support_conversations set message_seq = 9 where id = $1", [id]),
    ).rejects.toThrow("support_bad_event");
  });

  it("6. lets an agent write only in a conversation they have", async () => {
    const id = await conversation("people");
    expect(await refusal(add(id, "agent", agentA, "Hello"))).toBe("support_not_yours");
    await transition(id, "claim", { kind: "agent", id: agentA });
    expect(await refusal(add(id, "agent", agentB, "Hello"))).toBe("support_not_yours");
    expect((await add(id, "agent", agentA, "Hello")).rows).toHaveLength(1);
    // A note is staff-only and may come from anyone on the desk.
    expect((await add(id, "note", agentB, "VIP customer")).rows).toHaveLength(1);
  });

  it("7. writes nothing to an anonymised conversation, and the partner only to an open one", async () => {
    const id = await conversation("people");
    await transition(id, "claim", { kind: "agent", id: agentA });
    expect((await add(id, "partner", null, "Order 1042 was sent.")).rows).toHaveLength(1);
    await transition(id, "end", { kind: "agent", id: agentA });
    expect(await refusal(add(id, "partner", null, "Late help"))).toBe("support_ended");
    expect(await refusal(add(id, "customer", null, "Hello?"))).toBe("support_ended");
    expect((await add(id, "note", agentA, "Followed up by phone.")).rows).toHaveLength(1);
    await db.query("update commerce.support_conversations set anonymised_at = now() where id = $1", [id]);
    expect(await refusal(add(id, "note", agentA, "x"))).toBe("support_gone");
    expect(await refusal(transition(id, "reopen", { kind: "customer" }))).toBe("support_gone");
  });

  it("8. gives the partner one turn per customer message, none while paused", async () => {
    const id = await conversation("people");
    await transition(id, "claim", { kind: "agent", id: agentA });
    const { seq } = (await add(id, "customer", null, "Where is my parcel?")).rows[0];
    const take = () => one<{ won: boolean }>("select commerce.support_take_partner_turn($1, $2) as won", [id, seq]);
    const [first, second] = await Promise.all([take(), take()]);
    expect([first.won, second.won].sort()).toEqual([false, true]);
    const next = (await add(id, "customer", null, "Hello?")).rows[0].seq;
    await db.query("update commerce.support_conversations set partner_paused = true where id = $1", [id]);
    expect((await one<{ won: boolean }>("select commerce.support_take_partner_turn($1, $2) as won", [id, next])).won).toBe(false);
    // Never for a message that does not exist yet.
    await db.query("update commerce.support_conversations set partner_paused = false where id = $1", [id]);
    expect((await one<{ won: boolean }>("select commerce.support_take_partner_turn($1, $2) as won", [id, next + 5])).won).toBe(false);
  });

  it("9. holds the checks: assignee with a person, a token for the site, a requester for the admin, no customer on Kaizen's desk", async () => {
    const id = await conversation("people");
    await db.exec("begin");
    await db.query("select set_config('kaizen.support_transition', 'on', true)");
    const noAssignee = await refusal(db.query("update commerce.support_conversations set handler = 'human' where id = $1", [id]));
    await db.exec("rollback");
    expect(noAssignee).toMatch(/support_conversations_assignee/);

    await setMode("ai_first");
    expect(
      await refusal(db.query("insert into commerce.support_conversations (store_id, source, handler, locale) values ($1, 'site', 'ai', 'en')", [store])),
    ).toMatch(/support_conversations_token/);
    expect(
      await refusal(db.query("insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values ($1, 'admin', 'ai', 'adm-1', 'en')", [store])),
    ).toMatch(/support_conversations_requester/);

    await setMode("ai_first", null);
    const customer = (await one<{ id: string }>("insert into commerce.customers (store_id, email, name) values ($1, 'kari@example.com', 'Kari') returning id", [store])).id;
    expect(
      await refusal(
        db.query("insert into commerce.support_conversations (store_id, source, handler, token_hash, customer_id, locale) values (null, 'site', 'ai', 'k-1', $1, 'en')", [customer]),
      ),
    ).toMatch(/support_conversations_kaizen_customer/);

    // A customer who goes leaves the conversation without them, on the same desk.
    const withCustomer = (
      await one<{ id: string }>(
        "insert into commerce.support_conversations (store_id, source, handler, token_hash, customer_id, locale) values ($1, 'site', 'ai', 'c-1', $2, 'en') returning id",
        [store, customer],
      )
    ).id;
    await db.query("delete from commerce.customers where id = $1", [customer]);
    expect(await one("select store_id, customer_id from commerce.support_conversations where id = $1", [withCustomer])).toEqual({ store_id: store, customer_id: null });

    // Message lengths are the database's too.
    expect(await refusal(add(withCustomer, "customer", null, "x".repeat(1001)))).toMatch(/support_messages_body/);
  });

  it("puts an action on its conversation's desk", async () => {
    const id = await conversation("ai_first");
    const action = await one<{ store_id: string }>(
      `insert into commerce.support_actions (conversation_id, store_id, kind, confirmer, args, summary, expires_at)
       values ($1, null, 'booking.cancel', 'customer', '{}', 'Cancel your booking', now() + interval '30 minutes') returning store_id`,
      [id],
    );
    expect(action.store_id).toBe(store);
  });

  it("10. pings nothing and fails nothing without Realtime", async () => {
    await expect(db.query("select commerce.support_ping('sc:abc', 'm')")).resolves.toBeDefined();
    const id = await conversation("ai_first");
    await expect(add(id, "customer", null, "Hello")).resolves.toBeDefined();
  });
});
