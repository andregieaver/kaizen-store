import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const { runManagerTool } = await import("./manager-tools");
const notices = await import("./assistant-notices");
const skills = await import("./assistant-saved-skills");
const { ASSISTANT_SKILLS } = await import("@/lib/assistant-skills");

type Row = Record<string, unknown>;

/**
 * The AI manager tells and remembers (wave 8 unit F, D350): notices written once each for the person, counted, listed and marked read by
 * place, the autopilot's questions and finished plans swept in; and skills a person saves, loads with use_skill, shares as an owner and
 * deletes, refused with a customer's details, a secret or a built-in's name.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let conversation: string;

const ctxFor = async (account: { id: string; email: string; name: string | null; platformAdmin: boolean }, holder?: { role: string }) => ({
  account,
  store: (await getStore(store.slug))!,
  flags: {},
  connection: null,
  navigate: () => {},
  invalidate: () => {},
  ...(holder && { holder }),
  turn: { conversationId: conversation, said: "Save it", startedAt: new Date(), decide: async () => null },
});

beforeAll(async () => {
  store = await makeStore("notices");
  other = await makeStore("notices-other");
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_conversations (store_id, account_id, title) values (${store.id}::uuid, ${store.account.id}::uuid, 'Notices') returning id
  `);
  conversation = String(row.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_notices where account_id in (${store.account.id}::uuid, ${other.account.id}::uuid)`);
  await closeDb();
});

describe("notices (D350)", () => {
  it("keeps each once for the person, with its place's path, counts and lists it by place, and marks it read", async () => {
    const me = store.account.id;
    await notices.addNotice({ accountId: me, storeId: store.id, notice: "page_built", ref: "job-1", path: "pages/abc", facts: { title: "About us", extra: { nested: true } } });
    await notices.addNotice({ accountId: me, storeId: store.id, notice: "page_built", ref: "job-1", path: "pages/abc", facts: { title: "Twice" } });
    await notices.addNotice({ accountId: me, storeId: null, notice: "follow_up", ref: "f-1", path: "assistant?c=x", facts: { task: "Look again", outcome: "done" } });
    // Another person's notice is never theirs.
    await notices.addNotice({ accountId: other.account.id, storeId: other.id, notice: "report_ready", ref: "r-1", path: "assistant/autopilot" });

    const here = await notices.listNotices(me, store.id);
    expect(here.unread).toBe(1);
    expect(here.items).toEqual([
      expect.objectContaining({ kind: "page_built", href: `/admin/${store.slug}/pages/abc`, facts: { title: "About us" }, read: false, place: expect.any(String) }),
    ]);
    const everywhere = await notices.listNotices(me, "all");
    expect(everywhere.items.map((n) => n.kind).sort()).toEqual(["follow_up", "page_built"]);
    expect((await notices.listNotices(me, null)).items[0]).toMatchObject({ href: "/admin/platform/assistant?c=x", place: null });

    expect(await notices.markNoticesRead(me, store.id, [here.items[0].id])).toBe(1);
    expect(await notices.unreadNotices(me, store.id)).toBe(0);
    expect(await notices.unreadNotices(me, "all")).toBe(1);
    // Marking another's notice read changes nothing.
    const theirs = await notices.listNotices(other.account.id, "all");
    expect(await notices.markNoticesRead(me, "all", [theirs.items[0].id])).toBe(0);
    expect(await notices.markNoticesRead(me, "all", "all")).toBe(1);
  });

  it("tells of a change kept for a yes once, and of nothing already decided", async () => {
    const me = store.account.id;
    await notices.noticeApproval({ id: "00000000-0000-4000-8000-000000000001", summary: "Refund order 1042", status: "pending" }, conversation, me, store.id);
    await notices.noticeApproval({ id: "00000000-0000-4000-8000-000000000002", summary: "Done already", status: "done" }, conversation, me, store.id);
    const listed = await notices.listNotices(me, store.id);
    expect(listed.items.filter((n) => n.kind === "approval_waiting")).toEqual([
      expect.objectContaining({ facts: { summary: "Refund order 1042" }, href: `/admin/${store.slug}/assistant?c=${conversation}` }),
    ]);
  });

  it("sweeps in the autopilot's questions and finished plans for their makers, once", async () => {
    const me = store.account.id;
    const [plan] = await db().execute<Row>(sql`
      insert into commerce.assistant_plans (store_id, account_id, conversation_id, title, status)
      values (${store.id}::uuid, ${me}::uuid, ${conversation}::uuid, 'Launch plan', 'draft') returning id
    `);
    const [step] = await db().execute<Row>(sql`
      insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec)
      values (${String(plan.id)}::uuid, ${store.id}::uuid, 0, 's1', 'Which colour?', 'question', ${JSON.stringify({ kind: "question", text: "Which colour?" })}::jsonb)
      returning id
    `);
    await db().execute(sql`update commerce.assistant_plan_steps set status = 'asking' where id = ${String(step.id)}::uuid`);
    expect(await notices.noticeAutopilot()).toBeGreaterThanOrEqual(1);
    expect(await notices.noticeAutopilot()).toBe(0);
    const asked = (await notices.listNotices(me, store.id)).items.find((n) => n.kind === "plan_question");
    expect(asked).toMatchObject({ facts: { plan: "Launch plan", step: "Which colour?" }, href: `/admin/${store.slug}/assistant/autopilot` });
  });

  it("goes after 60 days", async () => {
    await db().execute(sql`update commerce.assistant_notices set created_at = now() - interval '61 days' where account_id = ${store.account.id}::uuid and ref = 'job-1'`);
    expect(await notices.pruneNotices()).toBeGreaterThanOrEqual(1);
    expect((await notices.listNotices(store.account.id, store.id)).items.some((n) => n.kind === "page_built")).toBe(false);
  });
});

describe("saved skills (D350)", () => {
  it("saves a person's skill, lists it in the prompt's lines and loads it with use_skill like a built-in one", async () => {
    const ctx = await ctxFor(store.account);
    const saved = (await runManagerTool(ctx as never, "save_skill", {
      title: "Weekly stock check",
      when: "When I ask for the weekly stock check",
      steps: ["Call low_stock", "List what is under 5, with the supplier"],
    })) as { done: string; skill: string };
    expect(saved).toEqual({ done: "Saved the skill.", skill: "weekly-stock-check", title: "Weekly stock check" });
    expect(await skills.savedSkillsText({ accountId: store.account.id, storeId: store.id })).toContain("weekly-stock-check: When I ask for the weekly stock check");
    const used = (await runManagerTool(ctx as never, "use_skill", { skill: "weekly-stock-check" })) as { steps: string[]; saved: boolean };
    expect(used).toMatchObject({ skill: "weekly-stock-check", saved: true, steps: ["Call low_stock", "List what is under 5, with the supplier"] });
    // A built-in one still comes first.
    const builtIn = ASSISTANT_SKILLS.find((s) => s.area === "store")!;
    expect(await runManagerTool(ctx as never, "use_skill", { skill: builtIn.id })).toMatchObject({ skill: builtIn.id, steps: builtIn.steps });

    const changed = (await runManagerTool(ctx as never, "save_skill", { skill: "weekly-stock-check", title: "Weekly stock check", steps: ["Call low_stock only"] })) as { done: string };
    expect(changed.done).toBe("Changed the skill.");
    expect((await skills.findSkill({ accountId: store.account.id, storeId: store.id }, "weekly-stock-check"))?.steps).toBe("Call low_stock only");
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${store.id}::uuid and action like 'ai.skill_%'`);
    expect(audited.n).toBe(2);
  });

  it("refuses a built-in's name, a customer's details, a secret and a marketing claim", async () => {
    const ctx = await ctxFor(store.account);
    const builtIn = ASSISTANT_SKILLS.find((s) => s.area === "store")!;
    await expect(runManagerTool(ctx as never, "save_skill", { title: builtIn.id.replaceAll("-", " "), steps: ["x"] })).rejects.toThrow(/built-in/);
    await expect(runManagerTool(ctx as never, "save_skill", { title: "Tell Kari", steps: ["Email kari@example.com"] })).rejects.toThrow(/email address/);
    await expect(runManagerTool(ctx as never, "save_skill", { title: "Login", steps: ["The password is hunter2"] })).rejects.toThrow(/password/);
    await expect(runManagerTool(ctx as never, "save_skill", { title: "Promo", steps: ["Say it is the best price in Norway"] })).rejects.toThrow(/marketing claim/);
  });

  it("lets only an owner share with the store; a colleague then sees it read only, and the owner may take it off", async () => {
    const owner = { accountId: store.account.id, storeId: store.id, owner: true };
    const shared = await skills.saveSkill(owner, { title: "Packing routine", when: "", steps: "Print the pick list\nPack by shelf", share: true });
    expect(shared).toMatchObject({ ok: true, skill: { shared: true, mine: true } });
    const staff = await makeAccount("notices-staff");
    await addMember(store.id, staff.id);
    const theirs = await skills.listSkills({ accountId: staff.id, storeId: store.id });
    expect(theirs.find((s) => s.key === "packing-routine")).toMatchObject({ mine: false, shared: true });
    // A colleague cannot share, change or delete it.
    expect(await skills.saveSkill({ accountId: staff.id, storeId: store.id, owner: false }, { title: "Mine", when: "", steps: "x", share: true })).toMatchObject({ ok: false, code: "share" });
    expect(await skills.deleteSkill({ accountId: staff.id, storeId: store.id, owner: false }, { key: "packing-routine" })).toBe(false);
    // Nobody shares on Kaizena Flow's own AI manager, and another store sees none of it.
    expect(await skills.saveSkill({ accountId: store.account.id, storeId: null, owner: true }, { title: "Platform", when: "", steps: "x", share: true })).toMatchObject({ ok: false, code: "share" });
    expect(await skills.listSkills({ accountId: other.account.id, storeId: other.id })).toEqual([]);
    expect(await skills.deleteSkill(owner, { key: "packing-routine" })).toBe(true);
    expect(await runManagerTool((await ctxFor(store.account)) as never, "delete_skill", { skill: "weekly-stock-check" })).toEqual({ done: "Deleted the skill." });
    await expect(runManagerTool((await ctxFor(store.account)) as never, "delete_skill", { skill: "weekly-stock-check" })).rejects.toThrow(/no skill/);
  });
});
