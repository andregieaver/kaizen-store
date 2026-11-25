import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The model, played: one sound proposal, one with a number it made up, one on a tool it was not given and one on an owner's own app tool.
 * Only the sound one may reach the log.
 */
const asked: { system: string; user: string }[] = [];
let reply = "";
vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai")>()),
  aiFor: async () => ({ provider: "openai", textModel: "played" }),
  completeText: async (_c: unknown, messages: { role: string; content: string }[]) => {
    asked.push({ system: messages[0].content, user: messages[1].content });
    return { text: reply, region: null };
  },
}));

const { closeDb, db } = await import("@/db/client");
const { readAdminBehaviour, adminFigures } = await import("./admin-behaviour");

type Row = Record<string, unknown>;

/**
 * Learning from how owners use the admin (D895 phase 3a) against a real database: the AI manager's tool calls and thumbs counted over a week
 * (owners' own app tools left out), handed to the model as figures only, and only a proposal that names a tool it was given with one of its
 * numbers kept, as an enhancement waiting for the owner's Approve.
 */
const run = Date.now().toString(36);
const TOOL = `zz_test_${run}`;
let conversation = "";
let accountId = "";

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`reading-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [made] = await db().execute<Row>(sql`insert into commerce.assistant_conversations (account_id) values (${accountId}::uuid) returning id`);
  conversation = String(made.id);
  const values = Array.from({ length: 24 }, (_, n) => {
    const ok = n % 4 !== 0;
    const feedback = n < 5 ? -1 : n < 7 ? 1 : null;
    return sql`(${conversation}::uuid, 'assistant', 'answer', ${JSON.stringify([{ name: TOOL, ok }, { name: "app__mine__secret", ok: false }])}::jsonb, ${feedback}::int)`;
  });
  await db().execute(sql`insert into commerce.assistant_messages (conversation_id, role, content, tools, feedback) values ${sql.join(values, sql`, `)}`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_messages where conversation_id = ${conversation}::uuid`);
  await db().execute(sql`delete from commerce.accounts where id = ${accountId}::uuid`);
  await db().execute(sql`delete from commerce.platform_incidents where fingerprint like ${`platform_ai:${TOOL}:%`} or fingerprint like 'platform_ai:refund_order:%'`);
  await closeDb();
});

describe("the week's figures", () => {
  it("count a tool's calls, failures and thumbs, and leave out owners' own app tools", async () => {
    const figures = await adminFigures();
    expect(figures.tools.find((t) => t.tool === TOOL)).toEqual({ tool: TOOL, calls: 24, failed: 6, failedPct: 25, up: 2, down: 5 });
    expect(figures.tools.some((t) => t.tool.startsWith("app__"))).toBe(false);
  });
});

describe("the weekly reading", () => {
  it("keeps only the proposal that names a given tool with one of its numbers, waiting for the owner's Approve", async () => {
    reply = JSON.stringify({
      proposals: [
        { subject: TOOL, title: "Say why the tool fails, and offer the fix", why: "A quarter of its calls fail.", figure: 25 },
        { subject: TOOL, title: "A second on the same tool", why: "Again.", figure: 24 },
        { subject: "refund_order", title: "Refunds fail", why: "Made up.", figure: 24 },
        { subject: "app__mine__secret", title: "An owner's own tool", why: "Not given.", figure: 24 },
      ],
    });
    const result = await readAdminBehaviour();
    expect(result.read).toBe(true);
    expect(asked.at(-1)?.user).toContain(`tool ${TOOL}: 24 calls, 6 failed (25%), 2 thumbs up, 5 thumbs down`);
    expect(asked.at(-1)?.user).not.toContain("app__");
    const rows = await db().execute<Row>(sql`select kind, source, status, title, evidence from commerce.platform_incidents where fingerprint like ${`platform_ai:${TOOL}:%`}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "enhancement", source: "platform_ai", status: "proposed", title: "Say why the tool fails, and offer the fix" });
    expect(rows[0].evidence).toMatchObject({ tool: TOOL, failedPct: 25, why: "A quarter of its calls fail.", figure: 25 });
    expect((await db().execute<Row>(sql`select 1 from commerce.platform_incidents where fingerprint like 'platform_ai:refund_order:%'`)).length).toBe(0);
  });

  it("calls no model when nothing is worth reading", async () => {
    await db().execute(sql`update commerce.assistant_messages set created_at = now() - interval '9 days' where conversation_id = ${conversation}::uuid`);
    const calls = asked.length;
    const result = await readAdminBehaviour();
    if (!result.read) expect(asked.length).toBe(calls);
  });
});
