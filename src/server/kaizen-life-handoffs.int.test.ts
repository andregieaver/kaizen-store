import { generateKeyPairSync, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FLOW_ISSUER, LIFE_ISSUER, checkLinkRequest, signLinkRequest } from "@/lib/kaizen-life-jwt";

import type { AssistantEvent, TurnInput } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
};
const FLOW = pair();
const LIFE = pair();
process.env.KAIZEN_LIFE_LINK_PRIVATE_KEY = FLOW.privateKeyPem.replace(/\n/g, "\\n");
process.env.KAIZEN_LIFE_LINK_PUBLIC_KEY = LIFE.publicKeyPem;
process.env.KAIZEN_LIFE_URL = "https://life-app.example";

const links = await import("./kaizen-life-accounts");
const handoffs = await import("./kaizen-life-handoffs");
const doors = await import("./kaizen-life-doors");
const assistant = await import("./owner-assistant");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);

async function makeOwner(who: string): Promise<{ id: string; email: string; slug: string }> {
  const email = `life-handoffs-${who}-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', 'Kaffe') returning id
  `);
  const slug = `life-handoffs-${who}-${run}`;
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Kaffe', null)`);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${email}`);
  await db().execute(sql`update commerce.accounts set auth_user_id = ${randomUUID()}::uuid where id = ${String(account.id)}::uuid`);
  return { id: String(account.id), email, slug };
}

/** A request to one of Flow's doors, signed as Kaizen Life signs it. */
async function ask(door: string, body: unknown) {
  const text = JSON.stringify(body);
  const token = signLinkRequest({ issuer: LIFE_ISSUER, audience: FLOW_ISSUER, path: `/api/kaizen-life/v1/${door}`, body: text, privateKeyPem: LIFE.privateKeyPem });
  const response = await doors.answerLifeDoor(
    door,
    new Request(`https://kaizenaflow.com/api/kaizen-life/v1/${door}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: text }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

type Sent = { path: string; body: Record<string, unknown>; checked: boolean };
/** Kaizen Life's doors, played in turn: each answer given back, each request kept and its signature checked with Flow's key. */
function lifeAnswers(...answers: (Record<string, unknown> | number)[]): { fetcher: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = String(init.body);
    const token = String((init.headers as Record<string, string>).authorization).replace(/^Bearer /, "");
    const path = new URL(url).pathname;
    const checked = checkLinkRequest(token, { issuer: FLOW_ISSUER, audience: LIFE_ISSUER, path, body, publicKeyPem: FLOW.publicKeyPem }).ok;
    sent.push({ path, body: JSON.parse(body) as Record<string, unknown>, checked });
    const answer = answers.shift() ?? 500;
    return typeof answer === "number" ? new Response("{}", { status: answer }) : Response.json(answer, { status: answer.accepted === true ? 202 : 200 });
  }) as unknown as typeof fetch;
  return { fetcher, sent };
}

const rowOf = async (id: string, direction: string) => {
  const [row] = await db().execute<Row>(sql`select * from commerce.kaizen_life_handoffs where id = ${id}::uuid and direction = ${direction}`);
  return row ?? null;
};

/** A turn of the AI manager played by the test: what it emits, or a change kept for a yes as the real tools keep one. */
function turnThat(play: (input: TurnInput, emit: (event: AssistantEvent) => void) => Promise<void> | void) {
  const inputs: TurnInput[] = [];
  return {
    inputs,
    turn: async (input: TurnInput) => {
      inputs.push(input);
      await play(input, input.emit);
    },
  };
}
const said = (content: string): AssistantEvent => ({
  type: "done",
  message: { id: randomUUID(), role: "assistant", content, tools: [], feedback: null, createdAt: new Date().toISOString() },
});

let owner: { id: string; email: string; slug: string };
const lifeUser = randomUUID();

beforeAll(async () => {
  owner = await makeOwner("owner");
  await links.linkAccounts(owner.id, lifeUser, "email");
});

afterAll(async () => {
  await closeDb();
});

describe("tasks handed to Kaizen Life (docs/assistants-together.md, step 2)", () => {
  let conversationId: string;
  const principal = async () => ({ account: { id: owner.id, email: owner.email, name: null, platformAdmin: false }, store: await getStore(owner.slug) });

  beforeAll(async () => {
    const store = await getStore(owner.slug);
    const [row] = await db().execute<Row>(sql`
      insert into commerce.assistant_conversations (store_id, account_id, title) values (${store!.id}::uuid, ${owner.id}::uuid, 'Talk') returning id
    `);
    conversationId = String(row.id);
  });

  it("hands a task over only while the assistants work together, and keeps nothing Kaizen Life did not take", async () => {
    await expect(handoffs.handToLife(await principal(), conversationId, "Remind me to call the roaster on Friday", lifeAnswers().fetcher)).rejects.toThrow("not switched on");
    await links.switchAssistantsFromFlow({ id: owner.id, assurance: { level: "aal1" } }, true, lifeAnswers({ ok: true }).fetcher);
    const refused = lifeAnswers({ accepted: false, error: "At most 20 tasks a day." });
    await expect(handoffs.handToLife(await principal(), conversationId, "Remind me", refused.fetcher)).rejects.toThrow("At most 20 tasks a day.");
    expect(await handoffs.lifeHandoffsOf(owner.id)).toEqual([]);
  });

  it("sends a signed task, lists it as working, and writes Kaizen Life's report into the conversation with a notice", async () => {
    const life = lifeAnswers({ accepted: true });
    const handed = await handoffs.handToLife(await principal(), conversationId, "Remind me to call the roaster on Friday", life.fetcher);
    expect(life.sent).toEqual([
      {
        path: "/api/kaizena-flow/v1/handoff",
        checked: true,
        body: { handoffId: handed.id, lifeUserId: lifeUser, flowAccountId: owner.id, task: "Remind me to call the roaster on Friday", from: "Kaffe" },
      },
    ]);
    expect(await handoffs.lifeHandoffsOf(owner.id)).toMatchObject([{ id: handed.id, status: "working" }]);

    const report = await ask("handoff-update", {
      handoffId: handed.id,
      lifeUserId: lifeUser,
      status: "done",
      result: "Added a reminder for Friday at 09:00.",
      link: "https://evil.example/phish",
    });
    expect(report).toEqual({ status: 200, body: { ok: true } });
    expect(await rowOf(handed.id, "to_life")).toMatchObject({ status: "done", result: "Added a reminder for Friday at 09:00.", link: null });
    const [message] = await db().execute<Row>(sql`
      select content from commerce.assistant_messages where conversation_id = ${conversationId}::uuid order by created_at desc limit 1
    `);
    expect(String(message.content)).toBe("[From Kaizen Life] Kaizen Life did: “Remind me to call the roaster on Friday”\n\nAdded a reminder for Friday at 09:00.");
    const [notice] = await db().execute<Row>(sql`select kind, facts from commerce.assistant_notices where account_id = ${owner.id}::uuid and kind = 'life_handoff'`);
    expect(notice.facts).toMatchObject({ outcome: "done" });
    // An ended task takes no more reports, and another account's Life user reaches none of it.
    expect((await ask("handoff-update", { handoffId: handed.id, lifeUserId: lifeUser, status: "failed" })).status).toBe(404);
    expect((await ask("handoff-update", { handoffId: handed.id, lifeUserId: randomUUID(), status: "done" })).status).toBe(404);
  });

  it("takes a task back, telling Kaizen Life, and keeps a link only to Kaizen Life's own pages", async () => {
    const handed = await handoffs.handToLife(await principal(), conversationId, "Find an hour next week", lifeAnswers({ accepted: true }).fetcher);
    const told = lifeAnswers({ ok: true });
    expect(await handoffs.cancelToLife(owner.id, handed.id, told.fetcher)).toMatchObject({ status: "cancelled" });
    expect(told.sent[0]).toMatchObject({ path: "/api/kaizena-flow/v1/handoff", body: { handoffId: handed.id, cancel: true } });
    expect(await handoffs.cancelToLife(owner.id, handed.id, told.fetcher)).toBeNull();

    const waiting = await handoffs.handToLife(await principal(), conversationId, "Book a slot", lifeAnswers({ accepted: true }).fetcher);
    await ask("handoff-update", { handoffId: waiting.id, lifeUserId: lifeUser, status: "waiting_for_you", link: "https://life-app.example/app/today" });
    expect(await rowOf(waiting.id, "to_life")).toMatchObject({ status: "waiting_for_you", link: "https://life-app.example/app/today", finished_at: null });
  });

  it("gives up a task Kaizen Life never reported on, telling the person", async () => {
    const handed = await handoffs.handToLife(await principal(), conversationId, "Plan my week", lifeAnswers({ accepted: true }).fetcher);
    await db().execute(sql`update commerce.kaizen_life_handoffs set updated_at = now() - interval '3 days' where id = ${handed.id}::uuid`);
    const result = await handoffs.runKaizenLifeHandoffs({ fetcher: lifeAnswers().fetcher });
    expect(result.givenUp).toBeGreaterThanOrEqual(1);
    expect(await rowOf(handed.id, "to_life")).toMatchObject({ status: "expired", result: "Kaizen Life did not report back." });
  });

  it("holds a day's tasks to the cap", async () => {
    await db().execute(sql`
      insert into commerce.kaizen_life_handoffs (id, account_id, direction, task, status)
      select gen_random_uuid(), ${owner.id}::uuid, 'to_life', 'filler', 'done' from generate_series(1, 20)
    `);
    await expect(handoffs.handToLife(await principal(), conversationId, "One more", lifeAnswers({ accepted: true }).fetcher)).rejects.toThrow("At most 20 tasks a day");
    await db().execute(sql`delete from commerce.kaizen_life_handoffs where account_id = ${owner.id}::uuid and task = 'filler'`);
  });
});

describe("tasks Kaizen Life hands a store's AI manager", () => {
  const take = (body: Record<string, unknown>) => ask("handoff", { lifeUserId: lifeUser, store: owner.slug, from: "Life", ...body });

  it("refuses while the assistants are apart, for a store not reached, and answers the same id twice", async () => {
    await links.switchAssistantsFromFlow({ id: owner.id }, false, lifeAnswers({ ok: true }).fetcher);
    expect(await take({ handoffId: randomUUID(), task: "Check the low stock" })).toEqual({ status: 403, body: { error: "assistants_off" } });
    await links.switchAssistantsFromFlow({ id: owner.id, assurance: { level: "aal1" } }, true, lifeAnswers({ ok: true }).fetcher);
    expect(await take({ handoffId: randomUUID(), task: "Check", store: "someone-elses" })).toEqual({ status: 403, body: { error: "store" } });
    const id = randomUUID();
    expect(await take({ handoffId: id, task: "Check the low stock" })).toEqual({ status: 202, body: { accepted: true, handoffId: id } });
    expect(await take({ handoffId: id, task: "Check the low stock" })).toEqual({ status: 202, body: { accepted: true, handoffId: id } });
    expect(await rowOf(id, "from_life")).toMatchObject({ status: "working", task: "Check the low stock", from_name: "Life", started_at: null });
  });

  it("runs a task as a turn nobody watches in the From Kaizen Life conversation, and tells Kaizen Life what it came to", async () => {
    const id = randomUUID();
    await take({ handoffId: id, task: "How many orders today?" });
    const played = turnThat((_, emit) => emit(said("Three orders today, all paid.")));
    const life = lifeAnswers({ ok: true });
    expect(await handoffs.runFromLife(id, { turn: played.turn, fetcher: life.fetcher })).toBe("done");
    expect(played.inputs[0]).toMatchObject({ fromKaizenLife: true, scheduled: true, outside: { client: "Kaizen Life", via: "kaizen-life", propose: false } });
    expect(played.inputs[0].message).toContain("The task: How many orders today?");
    expect(life.sent).toEqual([
      {
        path: "/api/kaizena-flow/v1/handoff-update",
        checked: true,
        body: expect.objectContaining({ handoffId: id, lifeUserId: lifeUser, flowAccountId: owner.id, status: "done", result: "Three orders today, all paid." }),
      },
    ]);
    expect(String(life.sent[0].body.link)).toMatch(/\/admin\/sign-in\/kaizen-life\?next=%2Fadmin%2F/);
    expect(await rowOf(id, "from_life")).toMatchObject({ status: "done" });
    // Never run twice.
    expect(await handoffs.runFromLife(id, { turn: played.turn, fetcher: life.fetcher })).toBeNull();
  });

  it("waits for the owner's yes on a change it kept, then tells Kaizen Life how the owner answered", async () => {
    const id = randomUUID();
    await take({ handoffId: id, task: "Put the espresso on sale" });
    const played = turnThat(async (input, emit) => {
      const approval = await assistant.keepForApproval(
        { account: input.member.account, store: input.member.store, invalidate: () => {}, outside: input.outside },
        input.conversationId!,
        "update_product",
        "change",
        { product: "espresso", status: "draft" },
      );
      emit({ type: "approval", approval });
      emit(said("I prepared the change."));
    });
    const first = lifeAnswers({ ok: true });
    expect(await handoffs.runFromLife(id, { turn: played.turn, fetcher: first.fetcher })).toBe("waiting_for_you");
    const row = await rowOf(id, "from_life");
    expect(row).toMatchObject({ status: "waiting_for_you" });
    expect((row!.approval_ids as string[]).length).toBe(1);
    expect(first.sent[0].body).toMatchObject({ status: "waiting_for_you" });
    expect(String(first.sent[0].body.result)).toContain("Waiting for the owner's yes in Kaizena Flow:");

    const approvalId = (row!.approval_ids as string[])[0];
    await db().execute(sql`update commerce.assistant_approvals set status = 'declined', decided_at = now() where id = ${approvalId}::uuid`);
    const second = lifeAnswers({ ok: true });
    await handoffs.settleHandoffAfterApproval(approvalId, second.fetcher);
    expect(await rowOf(id, "from_life")).toMatchObject({ status: "declined" });
    expect(second.sent[0].body).toMatchObject({ handoffId: id, status: "declined" });
    expect(String(second.sent[0].body.result)).toContain("Declined:");
  });

  it("takes a task back for Kaizen Life, declining what it kept", async () => {
    const id = randomUUID();
    await take({ handoffId: id, task: "Archive old products" });
    const played = turnThat(async (input, emit) => {
      emit({
        type: "approval",
        approval: await assistant.keepForApproval(
          { account: input.member.account, store: input.member.store, invalidate: () => {}, outside: input.outside },
          input.conversationId!,
          "update_product",
          "change",
          { product: "mug", status: "archived" },
        ),
      });
      emit(said("Prepared."));
    });
    await handoffs.runFromLife(id, { turn: played.turn, fetcher: lifeAnswers({ ok: true }).fetcher });
    expect(await take({ handoffId: id, cancel: true })).toEqual({ status: 200, body: { ok: true } });
    const row = await rowOf(id, "from_life");
    expect(row).toMatchObject({ status: "cancelled" });
    const [approval] = await db().execute<Row>(sql`select status from commerce.assistant_approvals where id = ${(row!.approval_ids as string[])[0]}::uuid`);
    expect(approval.status).toBe("declined");
  });

  it("fails a turn that errs, and the five-minute job runs a task whose run never started and tells Kaizen Life what it did not hear", async () => {
    const failing = randomUUID();
    await take({ handoffId: failing, task: "Something" });
    const broke = turnThat((_, emit) => emit({ type: "error", message: "The AI did not answer." }));
    const unheard = lifeAnswers(503);
    expect(await handoffs.runFromLife(failing, { turn: broke.turn, fetcher: unheard.fetcher })).toBe("failed");
    expect(await rowOf(failing, "from_life")).toMatchObject({ status: "failed", reported_at: null, report_tries: 1 });

    const lost = randomUUID();
    await take({ handoffId: lost, task: "Count the bookings" });
    await db().execute(sql`update commerce.kaizen_life_handoffs set created_at = now() - interval '2 minutes' where id = ${lost}::uuid`);
    const played = turnThat((_, emit) => emit(said("Two bookings.")));
    const life = lifeAnswers({ ok: true }, { ok: true }, { ok: true }, { ok: true });
    const result = await handoffs.runKaizenLifeHandoffs({ turn: played.turn, fetcher: life.fetcher });
    expect(result.ran).toBeGreaterThanOrEqual(1);
    expect(await rowOf(lost, "from_life")).toMatchObject({ status: "done" });
    expect(await rowOf(failing, "from_life")).toMatchObject({ report_tries: 0 });
    expect(life.sent.map((s) => s.body.handoffId)).toEqual(expect.arrayContaining([lost, failing]));
  });
});
