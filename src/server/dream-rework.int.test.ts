import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { REWORK_TOOLS } from "@/lib/dream-factory";
import { templateSettings } from "@/lib/theme";
import type { TurnInput } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { passMembership } = await import("./auth");
const { advanceDreamRuns, agreeReworkPlan, applyRework, askReworkChange, keptChanges, latestDreamRun, startDreamRework, startDreamRun, stopDreamRun } = await import("./dream-factory");
const { reworkPrepared } = await import("./dream-showcase");
const { keepForApproval } = await import("./owner-assistant");
const { addOwnLook, liveLook } = await import("./theme-installs");
const { draftHeaderFooterTool } = await import("./site-tools");

/**
 * A rework (D527) against the database: a store that is open is changed from its owner's words, and nothing its visitors see moves until
 * the owner's press. The AI's turns are stood in for by what their tools would leave: a look in the library, a page's draft, a change to
 * a product on the site kept for a yes.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const connection = { provider: "openai", textModel: "test-model" } as never;
type TestStore = { id: string; slug: string; owner: string; page: string; pageTitle: string; product: string; productTitle: string };

async function openStore(name: string): Promise<TestStore> {
  const email = `rework-${name.toLowerCase()}-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id`);
  const slug = `${name.toLowerCase()}-${run}`;
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${email})`);
  const id = String(store.id);
  // The store is open: its owner finished setting it up some time ago.
  await db().execute(sql`update commerce.stores set setup_completed_at = now() - interval '30 days' where id = ${id}::uuid`);
  const [page] = await db().execute<Row>(sql`
    select id, published ->> 'title' as title from commerce.pages where store_id = ${id}::uuid and type = 'page' and published is not null order by created_at limit 1
  `);
  // One of the store's products is its own (a demo product is never in a plan).
  const handle = `morning-mug-${run}`;
  const [product] = await db().execute<Row>(sql`
    update commerce.products set handle = ${handle}, status = 'active', updated_at = now()
    where id = (select id from commerce.products where store_id = ${id}::uuid and status = 'active' order by created_at limit 1)
    returning id
  `);
  await db().execute(sql`delete from commerce.store_demo_items where store_id = ${id}::uuid and kind = 'product' and ref_id = ${String(product.id)}::uuid`);
  const [title] = await db().execute<Row>(sql`select title from commerce.product_translations where product_id = ${String(product.id)}::uuid and title <> '' order by locale limit 1`);
  return { id, slug, owner: String(owner.id), page: String(page.id), pageTitle: String(page.title), product: handle, productTitle: String(title.title) };
}

async function minute(storeId: string, deps: Parameters<typeof advanceDreamRuns>[0]["deps"]) {
  await db().execute(sql`update commerce.dream_runs set claimed_until = null where store_id = ${storeId}::uuid`);
  return advanceDreamRuns({ deadline: Date.now() + 200_000, deps, storeId });
}

const planJson = (store: TestStore, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: "A warmer look, a front page that leads with the mugs, and a livelier mug.",
    look: "Warmer colours",
    header: "The logo in the middle",
    pages: [
      { page: store.page, title: "x", change: "Lead with the mugs" },
      { page: "99999999-9999-4999-8999-999999999999", title: "Not ours", change: "Rewrite" },
    ],
    newProducts: [],
    productChanges: [{ product: store.product, change: "A livelier title" }],
    outside: ["lower prices"],
    ...over,
  });

/** What the store's visitors see: the page's published title, the live look, and the product's titles. */
async function visible(store: TestStore) {
  const [page] = await db().execute<Row>(sql`select published ->> 'title' as title from commerce.pages where id = ${store.page}::uuid`);
  // The product's title in every language it has one.
  const titles = await db().execute<Row>(sql`
    select t.title from commerce.product_translations t join commerce.products p on p.id = t.product_id
    where p.store_id = ${store.id}::uuid and p.handle = ${store.product} and t.title <> '' order by t.locale
  `);
  const [site] = await db().execute<Row>(sql`select header_id from commerce.stores where id = ${store.id}::uuid`);
  return { page: String(page.title), look: (await liveLook(store.id))?.installId ?? null, product: titles.map((t) => String(t.title)), header: site.header_id ? String(site.header_id) : null };
}

/** The AI's turns, stood in for: each leaves what its own tools would. */
function standIn(store: TestStore, turns: TurnInput[]) {
  return async (input: TurnInput) => {
    turns.push(input);
    const tools = input.autopilot?.tools ?? [];
    const member = (await passMembership(store.slug, store.owner))!;
    if (tools.includes("draft_header_footer") && !tools.includes("edit_page")) {
      // A header drafted as the tool drafts one, and the call that would show it kept for a yes.
      const drafted = await draftHeaderFooterTool({ account: member.account, store: member.store, invalidate: () => {} }, { kind: "header", look: "centred" });
      const [conversation] = await db().execute<Row>(sql`
        insert into commerce.assistant_conversations (store_id, account_id, title) values (${store.id}::uuid, ${store.owner}::uuid, 'Rework') returning id
      `);
      input.emit({ type: "conversation", id: String(conversation.id), title: "Rework" });
      const approval = await keepForApproval({ account: member.account, store: member.store, invalidate: () => {} }, String(conversation.id), "use_header_footer", "public", {
        kind: "header",
        page: (drafted as unknown as { header: string }).header,
      });
      input.emit({ type: "approval", approval });
    } else if (tools.includes("design_look") && !tools.includes("edit_page")) {
      const made = await addOwnLook(store.id, store.owner, `Warm ${turns.length}`, { base: "warm", savedId: null, settings: templateSettings("warm") });
      if (!made.ok) throw new Error(made.problems.join(" "));
    } else if (tools.includes("edit_page") && !tools.includes("update_product")) {
      await db().execute(sql`update commerce.pages set draft = jsonb_set(draft, '{title}', '"Mugs first"'), updated_at = now() where id = ${store.page}::uuid`);
    } else if (tools.includes("update_product")) {
      // A change to a product on the site waits for a yes: the gate keeps it, in a conversation of the turn's own.
      const [conversation] = await db().execute<Row>(sql`
        insert into commerce.assistant_conversations (store_id, account_id, title) values (${store.id}::uuid, ${store.owner}::uuid, 'Rework') returning id
      `);
      input.emit({ type: "conversation", id: String(conversation.id), title: "Rework" });
      const approval = await keepForApproval({ account: member.account, store: member.store, invalidate: () => {} }, String(conversation.id), "update_product", "public", {
        product: store.product,
        title: "Livelier morning mug",
      });
      input.emit({ type: "approval", approval });
    }
  };
}

let shop: TestStore;
let aside: TestStore;

beforeAll(async () => {
  shop = await openStore("Rework");
  aside = await openStore("Aside");
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.dream_runs where store_id in (${shop.id}::uuid, ${aside.id}::uuid)`);
  await closeDb();
});

describe("a rework: the Dream Factory changing a store that is open (D527)", () => {
  it("builds no open store again, and starts one rework at a time for an owner", async () => {
    const member = (await passMembership(shop.slug, shop.owner))!;
    expect(await startDreamRun(member, "Hand-thrown ceramic mugs for Norway, from my small workshop.")).toMatchObject({ ok: false });
    expect(await startDreamRework(member, "Warmer")).toMatchObject({ ok: false });
    expect((await startDreamRework(member, "Make the look warmer, lead the front page with the mugs, and a livelier mug title.")).ok).toBe(true);
    expect(await startDreamRework(member, "Make the look warmer, and something else as well please.")).toMatchObject({ ok: false });
    expect(await latestDreamRun(shop.id)).toMatchObject({ kind: "rework", status: "running", ownerPresses: 1 });
  });

  it("plans from the store's own pages and products, prepares everything out of sight, and goes live only on the owner's press", async () => {
    const member = (await passMembership(shop.slug, shop.owner))!;
    const before = await visible(shop);
    const turns: TurnInput[] = [];
    const asked: string[] = [];
    const complete = async (_connection: unknown, messages: { content: unknown }[]) => {
      asked.push(messages.map((m) => String(m.content)).join("\n"));
      return { text: planJson(shop), region: null };
    };
    const deps = { complete, connection, turn: standIn(shop, turns) };

    await minute(shop.id, deps);
    let latest = (await latestDreamRun(shop.id))!;
    // The model was given the store's facts, and the page it named that is not the store's is not in the plan.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(shop.page);
    expect(latest.plan?.pages).toEqual([{ page: shop.page, title: shop.pageTitle, change: "Lead with the mugs" }]);
    expect(latest.plan?.productChanges).toEqual([{ product: shop.product, change: "A livelier title" }]);
    // Nothing is prepared before the owner's yes to the plan.
    expect(latest.steps.agree.status).toBe("asking");
    expect(latest.status).toBe("asking");
    expect(turns).toHaveLength(0);
    expect(await applyRework(member, latest.id)).toMatchObject({ ok: false });
    expect(await agreeReworkPlan(member, latest.id)).toEqual({ ok: true });

    // One turn of the AI a minute, each with its own tools, none of them at Just do it.
    for (let i = 0; i < 12 && (await latestDreamRun(shop.id))!.steps.review.status !== "asking"; i++) await minute(shop.id, deps);
    latest = (await latestDreamRun(shop.id))!;
    expect(latest.steps).toMatchObject({ relook: { status: "done" }, frame: { status: "done" }, pages: { status: "done" }, products: { status: "done" }, review: { status: "asking" } });
    expect(latest.status).toBe("asking");
    expect(latest.readyAt).not.toBeNull();
    expect(turns).toHaveLength(4);
    const offered = new Set(Object.values(REWORK_TOOLS).flat() as string[]);
    for (const turn of turns) {
      expect(Object.values(turn.autopilot?.settings.levels ?? {})).not.toContain("auto");
      for (const tool of turn.autopilot?.tools ?? []) expect(offered.has(tool), tool).toBe(true);
      expect(turn.scheduled).toBe(true);
    }

    // What visitors see has not moved.
    expect(await visible(shop)).toEqual(before);
    const prepared = await reworkPrepared(member.store, latest);
    expect(prepared.look).toMatchObject({ live: false });
    expect(prepared.pages).toMatchObject([{ id: shop.page, isNew: false, changed: true }]);
    expect(prepared.pages[0].differences).toContainEqual({ kind: "field", field: "title" });
    // The drafted header's use and the product's change both wait for the owner.
    expect(prepared.changes).toMatchObject([{ status: "pending" }, { status: "pending" }]);

    // One more change in the owner's words is one more turn; still nothing is live.
    expect(await askReworkChange(member, latest.id, "Call the look something warmer")).toEqual({ ok: true });
    await minute(shop.id, deps);
    latest = (await latestDreamRun(shop.id))!;
    expect(latest.steps.review).toMatchObject({ status: "asking", tries: 1 });
    expect(turns).toHaveLength(5);
    expect(await visible(shop)).toEqual(before);

    // The owner's press, then the minute's run makes it live: the page, the newest look and the product's kept change.
    expect(await applyRework(member, latest.id)).toEqual({ ok: true });
    await minute(shop.id, deps);
    latest = (await latestDreamRun(shop.id))!;
    expect(latest.steps.apply.detail).toContain("Live:");
    expect(latest.steps.apply.detail).not.toContain("Held back");
    expect(latest).toMatchObject({ status: "applied" });
    expect(latest.finishedAt).not.toBeNull();
    const after = await visible(shop);
    expect(after.page).toBe("Mugs first");
    expect(after.product).toContain("Livelier morning mug");
    expect(after.look).not.toBe(before.look);
    // The site shows the header the rework drafted.
    expect(after.header).not.toBeNull();
    expect(after.header).not.toBe(before.header);
    expect((await reworkPrepared(member.store, latest)).look).toMatchObject({ live: true });
    expect(await keptChanges(latest)).toEqual([]);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${shop.id}::uuid and action = 'store.dream_rework_applied'`);
    expect(audited.n).toBe(1);
    // The store is changed again from where it stands.
    expect((await startDreamRework(member, "Now make the front page a little shorter, please.")).ok).toBe(true);
  }, 120_000);

  it("asks at once when nothing asked for is the Dream Factory's to change, and a run set aside leaves the store as it was", async () => {
    const member = (await passMembership(aside.slug, aside.owner))!;
    const before = await visible(aside);
    expect((await startDreamRework(member, "Lower every price by ten per cent and send an email about it.")).ok).toBe(true);
    const turns: TurnInput[] = [];
    await minute(aside.id, { complete: async () => ({ text: planJson(aside, { look: "", header: "", pages: [], productChanges: [], outside: ["lower prices", "an email"] }), region: null }), connection, turn: standIn(aside, turns) });
    let latest = (await latestDreamRun(aside.id))!;
    expect(latest.steps.outline).toMatchObject({ status: "asking", tries: 0 });
    expect(latest.steps.agree.status).toBe("waiting");
    expect(await stopDreamRun(member, latest.id)).toEqual({ ok: true });

    // A second run prepares a product change, then is set aside: the change kept for a yes is declined, and nothing was ever live.
    expect((await startDreamRework(member, "Give the morning mug a livelier title, nothing else.")).ok).toBe(true);
    const deps = { complete: async () => ({ text: planJson(aside, { look: "", header: "", pages: [] }), region: null }), connection, turn: standIn(aside, turns) };
    await minute(aside.id, deps);
    latest = (await latestDreamRun(aside.id))!;
    expect(await agreeReworkPlan(member, latest.id)).toEqual({ ok: true });
    for (let i = 0; i < 6 && (await latestDreamRun(aside.id))!.steps.review.status !== "asking"; i++) await minute(aside.id, deps);
    latest = (await latestDreamRun(aside.id))!;
    expect(latest.steps).toMatchObject({ relook: { status: "skipped" }, frame: { status: "skipped" }, pages: { status: "skipped" }, products: { status: "done" }, review: { status: "asking" } });
    expect(await keptChanges(latest)).toHaveLength(1);
    expect(await stopDreamRun(member, latest.id)).toEqual({ ok: true });
    expect(await keptChanges(latest)).toEqual([]);
    expect(await keptChanges(latest, true)).toMatchObject([{ status: "declined" }]);
    await minute(aside.id, deps);
    expect((await latestDreamRun(aside.id))!.status).toBe("stopped");
    expect(await visible(aside)).toEqual(before);
  }, 120_000);
});
