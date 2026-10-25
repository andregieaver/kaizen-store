import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** The autopilot's plans (D309, `docs/ai-autopilot.md` 7.2): the life of a plan and its steps, as the database holds them. */

let db: PGlite;
let store: string;
let other: string;
let account: string;
let n = 0;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function plan(storeId: string | null = store): Promise<string> {
  const conversation = await scalar<string>("insert into commerce.assistant_conversations (store_id, account_id, title) values ($1, $2, 'Autopilot') returning id", [
    storeId,
    account,
  ]);
  return scalar<string>("insert into commerce.assistant_plans (store_id, account_id, conversation_id, title) values ($1, $2, $3, 'Launch') returning id", [
    storeId,
    account,
    conversation,
  ]);
}

async function step(planId: string, key = `s${++n}`, storeId: string | null = store): Promise<string> {
  return scalar<string>(
    `insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec)
     values ($1, $2, $3, $4, 'Write the about page', 'question', '{"text": "Which colour?", "options": []}') returning id`,
    [planId, storeId, n % 30, key],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "ap-a");
  other = await createInvoiceStore(db, "ap-b");
  account = await scalar<string>("insert into commerce.accounts (email) values ('owner-ap@example.com') returning id");
});

afterAll(async () => {
  await db.close();
});

describe("autopilot plans", () => {
  it("move draft, running, paused, done or stopped, and done and stopped are final", async () => {
    const id = await plan();
    await rejects("update commerce.assistant_plans set status = 'done' where id = $1", [id], /cannot go from draft to done/);
    await db.query("update commerce.assistant_plans set status = 'running' where id = $1", [id]);
    expect(await scalar("select started_at is not null from commerce.assistant_plans where id = $1", [id])).toBe(true);
    await db.query("update commerce.assistant_plans set status = 'paused', pause_reason = 'Paused by the owner.' where id = $1", [id]);
    await db.query("update commerce.assistant_plans set status = 'running' where id = $1", [id]);
    expect(await scalar("select pause_reason from commerce.assistant_plans where id = $1", [id])).toBeNull();
    await db.query("update commerce.assistant_plans set status = 'done' where id = $1", [id]);
    expect(await scalar("select finished_at is not null from commerce.assistant_plans where id = $1", [id])).toBe(true);
    await rejects("update commerce.assistant_plans set status = 'stopped' where id = $1", [id], /plan that is done cannot change/);
  });

  it("go back to a draft only with their version raised, and change steps only as a draft", async () => {
    const id = await plan();
    await db.query("update commerce.assistant_plans set status = 'running' where id = $1", [id]);
    await rejects("update commerce.assistant_plans set status = 'draft' where id = $1", [id], /only when its steps change/);
    await rejects("update commerce.assistant_plans set version = 2 where id = $1", [id], /only while it is a draft/);
    await rejects(
      `insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec) values ($1, $2, 0, 'late', 'Late', 'wait', '{}')`,
      [id, store],
      /only to a draft plan/,
    );
    await db.query("update commerce.assistant_plans set status = 'draft', version = 2 where id = $1", [id]);
    await rejects("update commerce.assistant_plans set version = 1 where id = $1", [id], /only grows/);
    await step(id);
  });

  it("keep a plan's store, person and conversation", async () => {
    const id = await plan();
    await rejects("update commerce.assistant_plans set store_id = $2 where id = $1", [id, other], /are fixed/);
  });
});

describe("autopilot steps", () => {
  it("belong to their plan's store and start pending", async () => {
    const id = await plan();
    await rejects(
      `insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec) values ($1, $2, 0, 'x1', 'X', 'wait', '{}')`,
      [id, other],
      /plan's store/,
    );
    await rejects(
      `insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec, status) values ($1, $2, 0, 'x2', 'X', 'wait', '{}', 'done')`,
      [id, store],
      /starts pending/,
    );
    await rejects(
      `insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec) values ($1, $2, 0, 'Bad Key', 'X', 'wait', '{}')`,
      [id, store],
      /assistant_plan_steps_key/,
    );
  });

  it("run only while their plan runs, move forward and are final once done", async () => {
    const id = await plan();
    const s = await step(id);
    await rejects("update commerce.assistant_plan_steps set status = 'running' where id = $1", [s], /only while its plan runs/);
    await db.query("update commerce.assistant_plans set status = 'running' where id = $1", [id]);
    await db.query("update commerce.assistant_plan_steps set status = 'running', claimed_until = now() + interval '10 minutes' where id = $1", [s]);
    await rejects("update commerce.assistant_plan_steps set title = 'Other' where id = $1", [s], /only while its plan is a draft/);
    await db.query("update commerce.assistant_plan_steps set status = 'done' where id = $1", [s]);
    expect(await scalar("select claimed_until is null and finished_at is not null from commerce.assistant_plan_steps where id = $1", [s])).toBe(true);
    await rejects("update commerce.assistant_plan_steps set status = 'pending' where id = $1", [s], /step that is done cannot change/);
  });

  it("are answered only while they ask, and their tries start again only on try again", async () => {
    const id = await plan();
    const s = await step(id);
    await db.query("update commerce.assistant_plans set status = 'running' where id = $1", [id]);
    await rejects("update commerce.assistant_plan_steps set answer = 'Blue' where id = $1", [s], /only while it asks/);
    await db.query("update commerce.assistant_plan_steps set status = 'running' where id = $1", [s]);
    await db.query("update commerce.assistant_plan_steps set status = 'pending', tries = 3 where id = $1", [s]);
    await rejects("update commerce.assistant_plan_steps set tries = 0 where id = $1", [s], /start again only/);
    await db.query(`update commerce.assistant_plan_steps set status = 'asking', question = '{"text": "?", "options": [], "retry": true}' where id = $1`, [s]);
    await db.query("update commerce.assistant_plan_steps set status = 'pending', tries = 0, answer = 'Try again' where id = $1", [s]);
    expect(await scalar("select tries from commerce.assistant_plan_steps where id = $1", [s])).toBe(0);
  });

  it("are removed only from a draft and never once they ran; a deleted plan takes them along", async () => {
    const id = await plan();
    const keep = await step(id);
    const gone = await step(id);
    await db.query("delete from commerce.assistant_plan_steps where id = $1", [gone]);
    await db.query("update commerce.assistant_plans set status = 'running' where id = $1", [id]);
    await rejects("delete from commerce.assistant_plan_steps where id = $1", [keep], /only from a draft/);
    await db.query("update commerce.assistant_plan_steps set status = 'done' where id = $1", [keep]);
    await db.query("update commerce.assistant_plans set status = 'draft', version = 2 where id = $1", [id]);
    await rejects("delete from commerce.assistant_plan_steps where id = $1", [keep], /never once it ran/);
    await db.query("delete from commerce.assistant_plans where id = $1", [id]);
    expect(await scalar<number>("select count(*)::int from commerce.assistant_plan_steps where plan_id = $1", [id])).toBe(0);
  });

  it("serve Kaizena Flow's own site with no store", async () => {
    const id = await plan(null);
    await step(id, "p1", null);
    await rejects(
      `insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec) values ($1, $2, 0, 'p2', 'X', 'wait', '{}')`,
      [id, store],
      /plan's store/,
    );
  });
});

describe("approvals and the activity log", () => {
  it("keep a plan's start as its own gate and settle with the step's id cleared when it goes", async () => {
    const id = await plan();
    const s = await step(id);
    const conversation = await scalar<string>("select conversation_id from commerce.assistant_plans where id = $1", [id]);
    const approval = await scalar<string>(
      `insert into commerce.assistant_approvals (store_id, conversation_id, account_id, tool, args, summary, category, plan_step_id)
       values ($1, $2, $3, 'start_autopilot_plan', '{}', 'Start', 'plan', $4) returning id`,
      [store, conversation, account, s],
    );
    await db.query("delete from commerce.assistant_plan_steps where id = $1", [s]);
    expect(await scalar("select plan_step_id from commerce.assistant_approvals where id = $1", [approval])).toBeNull();
    await rejects(
      `insert into commerce.assistant_approvals (store_id, conversation_id, account_id, tool, args, summary, category) values ($1, $2, $3, 'x', '{}', 'x', 'other')`,
      [store, conversation, account],
      /assistant_approvals_category/,
    );
  });

  it("say who acted: a person by default, the AI manager or the autopilot, nothing else", async () => {
    const id = await scalar<number>("insert into commerce.audit_log (store_id, account_id, action, area) values ($1, $2, 'ai.goal_set', 'settings') returning id", [store, account]);
    expect(await scalar("select acted_by from commerce.audit_log where id = $1", [id])).toBe("person");
    await db.query("insert into commerce.audit_log (store_id, account_id, action, area, acted_by) values ($1, $2, 'ai.plan_made', 'settings', 'autopilot')", [store, account]);
    await rejects("insert into commerce.audit_log (store_id, account_id, action, area, acted_by) values ($1, $2, 'ai.plan_made', 'settings', 'robot')", [store, account], /audit_log_acted_by/);
  });
});
