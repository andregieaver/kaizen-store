import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { Approval, AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const assistant = await import("./owner-assistant");
const ownerTools = await import("./owner-tools");
const admin = await import("./experiment-admin");
const stores = await import("./stores");

type Row = Record<string, unknown>;

/**
 * The AI manager's A/B test tools (D148, phase 4): what it can read (suggestions, a list, the results in words), the draft it
 * makes (words checked, nothing live), and the three calls that change what visitors see, kept for the owner's yes and
 * checked first so they are never asked to approve what could not be done.
 */

const run = Date.now().toString(36);
let member: Membership;
const tags: string[] = [];
const ctx = () => ({ account: member.account, store: member.store, invalidate: (tag: string) => void tags.push(tag) });

const connection = {
  provider: "openai",
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  textEuOnly: false,
  zeroDataRetention: false,
} as unknown as AiConnection;

beforeAll(async () => {
  const name = `tools-ab-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Kaffe', null)`);
  const store = (await stores.getStore(name))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  const id = member.store.id;
  await db().execute(sql`delete from commerce.assistant_approvals where store_id = ${id}::uuid`);
  await db().execute(sql`delete from commerce.assistant_conversations where store_id = ${id}::uuid`);
  await closeDb();
});

/** A provider answering in the stream format: text in pieces, or tool calls. */
const sse = (chunks: unknown[]) =>
  new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
const says = (text: string) =>
  sse(text.match(/[\s\S]{1,7}/g)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })));
const calls = (...tools: { name: string; args: unknown }[]) =>
  sse(
    tools.map((tool, index) => ({
      choices: [
        {
          delta: {
            tool_calls: [
              { index, id: `call-${index}`, function: { name: tool.name, arguments: JSON.stringify(tool.args) } },
            ],
          },
        },
      ],
    })),
  );

function fakeModel(...answers: Response[]) {
  const requests: { messages: { role: string; content: string | null }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return answers.shift() ?? says("(no more answers)");
    }),
  );
  return requests;
}

async function turn(message: string, conversationId: string | null = null) {
  const events: AssistantEvent[] = [];
  await assistant.runTurn({
    member,
    conversationId,
    message,
    emit: (e) => events.push(e),
    invalidate: (tag) => void tags.push(tag),
    connection,
  });
  return events;
}

/** The call kept for approval in a turn, decided as the owner would. */
async function keptAndApproved(tool: string, args: unknown, conversationId: string | null = null) {
  fakeModel(calls({ name: tool, args }), says("Venter på at du godkjenner."));
  const events = await turn(`Gjør ${tool}`, conversationId);
  const queued = (events.find((e) => e.type === "approval") as { approval: Approval } | undefined)?.approval;
  expect(queued, tool).toMatchObject({ tool, category: "public", status: "pending" });
  return { queued: queued!, events };
}


const headingOf = async (pageId: string) => {
  const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${pageId}::uuid`);
  const blocks = (row.published as { rows: { columns: { blocks: { id: string; text?: string }[] }[] }[] }).rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
  return blocks.find((b) => b.id === "heading-about")?.text;
};

describe("the AI manager's A/B test tools (D148)", () => {
  let aboutId: string;
  let versionB: string;
  let testId: string;

  it("starts with nothing running, and offers what can be tested with each block's words and id", async () => {
    expect(await ownerTools.runOwnerTool(ctx(), "list_experiments", {})).toMatchObject({ tests: [], running: 0, most_at_once: 5 });
    const suggest = (await ownerTools.runOwnerTool(ctx(), "suggest_experiments", {})) as {
      can_be_tested: { target: string; kind: string; blocks: { id: string; kind: string; text: string }[] }[];
      room_for_more: number;
      who_takes_part: string;
      how_long: unknown;
      paid_orders_last_30_days: number;
    };
    const about = suggest.can_be_tested.find((t) => t.target === "om-oss");
    expect(about).toMatchObject({ kind: "page" });
    expect(about!.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ id: "heading-about", kind: "heading", text: "Om Kaizen Demo" })]));
    expect(suggest.room_for_more).toBe(5);
    expect(suggest.who_takes_part).toMatch(/Too few cookie choices/);
    expect(typeof suggest.how_long).toBe("string");
    // With visitors and a rate it works out how long, in code.
    const timed = (await ownerTools.runOwnerTool(ctx(), "suggest_experiments", { visitors_per_day: 400, current_rate_percent: 3 })) as { how_long: { about_days: number; sentence: string } };
    expect(timed.how_long.about_days).toBeGreaterThanOrEqual(14);
    expect(timed.how_long.sentence).toMatch(/visitors for each version/);
    const [row] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${member.store.id}::uuid and type = 'page' and slug = 'om-oss'`);
    aboutId = String(row.id);
  });

  it("refuses words the store cannot back, a block that is not there and a button that does not exist, before anything is made", async () => {
    const draft = (input: Record<string, unknown>) => ownerTools.runOwnerTool(ctx(), "draft_experiment", { target: "om-oss", goal: "cart", ...input });
    await expect(draft({ changes: [{ block: "heading-about", text: "The best price in Norway, guaranteed" }] })).rejects.toThrow(/Rewrite without claims/);
    await expect(draft({ changes: [{ block: "nope", text: "Hello" }] })).rejects.toThrow(/no block nope/);
    await expect(draft({ goal: "click" })).rejects.toThrow(/name the button/);
    await expect(draft({ goal: "click", button: "Buy now", changes: [] })).rejects.toThrow(/no button "Buy now"/);
    await expect(ownerTools.runOwnerTool(ctx(), "draft_experiment", { target: "does-not-exist", goal: "cart" })).rejects.toThrow(/cannot be tested now/);
    expect(await admin.listExperiments(member.store.id)).toEqual([]);
  });

  it("makes a draft with the new words in version B only, as a test of that block, and shows nothing to visitors", async () => {
    const made = (await ownerTools.runOwnerTool(ctx(), "draft_experiment", {
      target: "om-oss",
      goal: "cart",
      name: "Varmere overskrift",
      hypothesis: "A warmer heading makes more people look at the shop",
      changes: [{ block: "heading-about", text: "Velkommen til en rolig butikk" }],
    })) as { done: string; id: string; tests: string; next: string };
    testId = made.id;
    expect(made.done).toContain("Nothing is shown to visitors yet");
    expect(made.tests).toMatch(/^Heading “Om Kaizen Demo” in row 1 only$/);
    expect(made.next).toMatch(/start_experiment, which needs their approval/);
    const test = (await admin.getExperiment(member.store.id, testId))!;
    expect(test).toMatchObject({ status: "draft", name: "Varmere overskrift", goal: "cart", part: { id: "heading-about", kind: "block" } });
    versionB = test.variants.find((v) => v.key === "b")!.pageId!;
    expect(await headingOf(versionB)).toBe("Velkommen til en rolig butikk");
    // The original is not touched, and nothing runs.
    expect(await headingOf(aboutId)).toBe("Om Kaizen Demo");
    expect((await ownerTools.runOwnerTool(ctx(), "list_experiments", {})) as { running: number }).toMatchObject({ running: 0 });
    // A draft says what is left, and that it can be started.
    expect(await ownerTools.runOwnerTool(ctx(), "explain_results", { experiment: "varmere overskrift" })).toMatchObject({
      test: { status: "Draft", tests: expect.stringContaining("/om-oss") },
      results: expect.stringContaining("has not started"),
      what_is_left: [expect.stringContaining("start_experiment")],
    });
  });

  it("is kept for approval to start, described from the test, and starts only on a yes", async () => {
    const { queued } = await keptAndApproved("start_experiment", { experiment: "Varmere overskrift" });
    expect(queued.summary).toContain('Start the A/B test "Varmere overskrift"');
    expect(queued.summary).toContain("/om-oss, Heading “Om Kaizen Demo” in row 1");
    expect(queued.summary).toContain("2 versions, 100 % of the visitors who accepted statistics cookies, at least 14 days");
    expect((await admin.getExperiment(member.store.id, testId))!.status).toBe("draft");
    const decided = await assistant.decideApproval(member, queued.id, true, (tag) => void tags.push(tag));
    expect(decided).toMatchObject({ status: "done", outcome: expect.stringContaining("is running") });
    expect((await admin.getExperiment(member.store.id, testId))!.status).toBe("running");
  });

  it("lists and explains a running test from the store's own figures, with what to do next", async () => {
    const listed = (await ownerTools.runOwnerTool(ctx(), "list_experiments", {})) as { running: number; tests: { name: string; status: string; verdict: { kind: string; headline: string } }[] };
    expect(listed.running).toBe(1);
    expect(listed.tests[0]).toMatchObject({ name: "Varmere overskrift", status: "Running", verdict: { kind: "few" } });
    const explained = (await ownerTools.runOwnerTool(ctx(), "explain_results", { experiment: testId })) as {
      verdict: { kind: string; headline: string };
      versions: { version: string; visitors: number; rate: string }[];
      split_between_versions: string;
      what_next: string[];
      never: string;
      how_it_is_counted: string;
    };
    expect(explained.verdict.kind).toBe("few");
    expect(explained.versions.map((v) => v.version)).toEqual(["Original", "Version B"]);
    expect(explained.versions[0]).toMatchObject({ visitors: 0, rate: "0 %" });
    expect(explained.what_next[0]).toMatch(/Keep it running/);
    expect(explained.never).toMatch(/Do not call a winner/);
    expect(explained.how_it_is_counted).toMatch(/accepted statistics cookies/);
    await expect(ownerTools.runOwnerTool(ctx(), "explain_results", { experiment: "nobody" })).rejects.toThrow(/No A\/B test "nobody"/);
  });

  it("refuses at once what could not be done, so no one is asked to approve it", async () => {
    // Already running; a stopped test; an unknown version; an unknown test.
    await expect(ownerTools.preflightOwnerTool(ctx(), "start_experiment", { experiment: "Varmere overskrift" })).rejects.toThrow(/is running, not a draft/);
    await expect(ownerTools.preflightOwnerTool(ctx(), "apply_winner", { experiment: "Varmere overskrift", version: "c" })).rejects.toThrow(/no version C/);
    await expect(ownerTools.preflightOwnerTool(ctx(), "stop_experiment", { experiment: "nobody" })).rejects.toThrow(/No A\/B test/);
    // Through a turn: the model's call comes back as an error, with no approval kept.
    fakeModel(calls({ name: "start_experiment", args: { experiment: "Varmere overskrift" } }), says("Den kjører allerede."));
    const events = await turn("Start testen");
    expect(events.some((e) => e.type === "approval")).toBe(false);
  });

  it("stops a running test only on a yes, and everyone sees the original again", async () => {
    const { queued } = await keptAndApproved("stop_experiment", { experiment: "Varmere overskrift" });
    expect(queued.summary).toContain('Stop the A/B test "Varmere overskrift"');
    expect((await admin.getExperiment(member.store.id, testId))!.status).toBe("running");
    const decided = await assistant.decideApproval(member, queued.id, true, (tag) => void tags.push(tag));
    expect(decided).toMatchObject({ status: "done", outcome: expect.stringContaining("is stopped") });
    expect((await admin.getExperiment(member.store.id, testId))!).toMatchObject({ status: "stopped", stopReason: "person" });
    await expect(ownerTools.preflightOwnerTool(ctx(), "stop_experiment", { experiment: testId })).rejects.toThrow(/is stopped, not running/);
  });

  it("chooses a version only on a yes, putting that block into the page as it is now and nothing else", async () => {
    // The page was edited elsewhere while the test ran: the choice keeps that.
    await db().execute(sql`
      update commerce.pages set published = jsonb_set(published, '{rows,0,columns,0,blocks,1,htmlId}', '"edited-after"'), draft = jsonb_set(draft, '{rows,0,columns,0,blocks,1,htmlId}', '"edited-after"') where id = ${aboutId}::uuid
    `);
    const { queued } = await keptAndApproved("apply_winner", { experiment: "Varmere overskrift", version: "b" });
    expect(queued.summary).toContain("make Version B replace Heading “Om Kaizen Demo” in row 1 for good");
    expect(await headingOf(aboutId)).toBe("Om Kaizen Demo");
    const decided = await assistant.decideApproval(member, queued.id, true, (tag) => void tags.push(tag));
    expect(decided).toMatchObject({ status: "done", outcome: expect.stringContaining("Version B is now Heading") });
    expect(await headingOf(aboutId)).toBe("Velkommen til en rolig butikk");
    const [row] = await db().execute<Row>(sql`select published -> 'rows' -> 0 -> 'columns' -> 0 -> 'blocks' -> 1 ->> 'htmlId' as id from commerce.pages where id = ${aboutId}::uuid`);
    expect(row.id).toBe("edited-after");
    expect((await admin.getExperiment(member.store.id, testId))!).toMatchObject({ status: "applied", appliedVariant: "b" });
    expect((await ownerTools.runOwnerTool(ctx(), "explain_results", { experiment: "Varmere overskrift" })) as { test: { winner: string } }).toMatchObject({ test: { winner: "Version B" } });
  });

  it("stops a running test and chooses in one yes, and keeps the original when told to", async () => {
    const made = (await ownerTools.runOwnerTool(ctx(), "draft_experiment", {
      target: "om-oss",
      goal: "orders",
      name: "Ny knapp",
      changes: [{ block: "text-about", text: "Vi selger ting for hjem og kontor, enkelt og rolig." }],
    })) as { id: string };
    const start = await keptAndApproved("start_experiment", { experiment: made.id });
    await assistant.decideApproval(member, start.queued.id, true, () => {});
    expect((await admin.getExperiment(member.store.id, made.id))!.status).toBe("running");
    const { queued } = await keptAndApproved("apply_winner", { experiment: "Ny knapp", version: "original" });
    expect(queued.summary).toContain("Stop the test, then end the A/B test");
    expect(queued.summary).toContain("keep the original");
    await assistant.decideApproval(member, queued.id, true, () => {});
    expect((await admin.getExperiment(member.store.id, made.id))!.status).toBe("discarded");
    expect(await headingOf(aboutId)).toBe("Velkommen til en rolig butikk");
  });

  it("gives the reason before the yes when a draft cannot start yet, and says what is left in explain_results", async () => {
    const made = (await ownerTools.runOwnerTool(ctx(), "draft_experiment", { target: "om-oss", goal: "checkout", name: "Uendret kopi" })) as { id: string; next: string };
    expect(made.next).toMatch(/copy of the original/);
    await expect(ownerTools.preflightOwnerTool(ctx(), "start_experiment", { experiment: "Uendret kopi" })).rejects.toThrow(/still the same as the original/);
    fakeModel(calls({ name: "start_experiment", args: { experiment: "Uendret kopi" } }), says("Den kan ikke startes ennå."));
    expect((await turn("Start den")).some((e) => e.type === "approval")).toBe(false);
    expect((await ownerTools.runOwnerTool(ctx(), "explain_results", { experiment: "Uendret kopi" })) as { what_is_left: string[] }).toMatchObject({
      what_is_left: [expect.stringContaining("still the same as the original")],
    });
    expect((await admin.deleteDraft(member.account, member.store.id, made.id)).ok).toBe(true);
  });
});
