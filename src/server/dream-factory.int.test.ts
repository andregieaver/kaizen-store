import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { TurnInput } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { activeAccount, passMembership } = await import("./auth");
const { featureOn } = await import("@/lib/store-features");
const { advanceDreamRuns, answerDreamBrief, confirmDreamBrief, latestDreamRun, startDreamRun, startDreamStore, stopDreamRun } = await import("./dream-factory");

/** The Dream Factory's conductor (D409) against the database: the brief, the owner's presses, the lanes, the checks and a test run's end. */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const connection = { provider: "openai", textModel: "test-model" } as never;

async function newStore(name: string, email: string): Promise<{ id: string; slug: string; owner: string }> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id
  `);
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${run}`;
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${email})`);
  return { id: String(store.id), slug, owner: String(owner.id) };
}

const briefJson = (business: Record<string, string>, countries: string[] = ["NO"]) =>
  JSON.stringify({
    storeName: "Leire",
    sells: "Hand-thrown ceramic mugs and bowls",
    audience: "people who like slow mornings",
    countries,
    languages: ["Norwegian"],
    currency: "NOK",
    products: 3,
    business,
  });

/** Moves the run on as the minute's cron would, as if a minute had passed since the last time. */
async function minute(storeId: string, deps: Parameters<typeof advanceDreamRuns>[0]["deps"]) {
  await db().execute(sql`update commerce.dream_runs set claimed_until = null where store_id = ${storeId}::uuid`);
  return advanceDreamRuns({ deadline: Date.now() + 200_000, deps });
}

let test: { id: string; slug: string; owner: string };
let real: { id: string; slug: string; owner: string };
let nordic: { id: string; slug: string; owner: string };

beforeAll(async () => {
  test = await newStore("Dream test", `delivered+dream${run}@resend.dev`);
  real = await newStore("Dream real", `dream-${run}@example.com`);
  nordic = await newStore("Dream nordic", `delivered+nordic${run}@resend.dev`);
  // Each store is a copy of the Standard store.
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.dream_runs where store_id in (${test.id}::uuid, ${real.id}::uuid, ${nordic.id}::uuid)`);
  await db().execute(sql`delete from commerce.dream_runs where store_id in (select id from commerce.stores where slug like ${`another-${run}%`})`);
  await closeDb();
});

describe("the Dream Factory (D409)", () => {
  it("starts a run for an owner only, from a description of the right length, one at a time", async () => {
    const member = (await passMembership(real.slug, real.owner))!;
    expect(await startDreamRun(member, "Too short")).toMatchObject({ ok: false });
    const started = await startDreamRun(member, "Hand-thrown ceramic mugs for Norway, from my small workshop.");
    expect(started.ok).toBe(true);
    expect(await startDreamRun(member, "Hand-thrown ceramic mugs for Norway, from my small workshop.")).toMatchObject({ ok: false });
    const latest = await latestDreamRun(real.id);
    expect(latest).toMatchObject({ test: false, status: "running", ownerPresses: 1 });
  });

  it("asks the owner what the description did not give, never inventing the business", async () => {
    const complete = vi.fn(async () => ({ text: briefJson({ legalName: "Leire Keramikk AS", postalAddress: "Fjordveien 9, Bergen", contactEmail: "post@leire.no", country: "NO" }), region: null }));
    await minute(real.id, { complete, connection, turn: async () => {} });
    let latest = (await latestDreamRun(real.id))!;
    expect(complete).toHaveBeenCalledTimes(1);
    expect(latest.steps.brief.status).toBe("asking");
    // The description named none of these: the brief keeps none of them.
    expect(latest.brief?.business).toMatchObject({ legalName: "", postalAddress: "", contactEmail: "" });
    expect(latest.status).toBe("asking");

    const member = (await passMembership(real.slug, real.owner))!;
    expect(await answerDreamBrief(member, latest.id, { legalName: "Leire Keramikk AS", postalAddress: "Storgata 1, 0155 Oslo", contactEmail: "hei@leire.no", country: "NO" })).toEqual({ ok: true });
    latest = (await latestDreamRun(real.id))!;
    expect(latest.steps.brief.status).toBe("done");
    expect(latest.ownerPresses).toBe(2);

    // The yes to the brief is the owner's: the run waits for it.
    await minute(real.id, { complete, connection, turn: async () => {} });
    latest = (await latestDreamRun(real.id))!;
    expect(latest.steps.confirm.status).toBe("asking");
    expect(latest.steps.research.status).toBe("waiting");
    expect(await confirmDreamBrief(member, latest.id)).toEqual({ ok: true });
    expect((await latestDreamRun(real.id))!.steps.confirm.status).toBe("done");
    expect(await stopDreamRun(member, latest.id)).toEqual({ ok: true });
    expect((await latestDreamRun(real.id))!.status).toBe("stopped");
  });

  it("runs a test run's lanes with the step's own tools and checks each by the store's rows", async () => {
    const member = (await passMembership(test.slug, test.owner))!;
    const prompt = "Ceramic mugs for Norway. Leire Keramikk AS, Storgata 1, 0155 Oslo, hei@leire.no";
    expect((await startDreamRun(member, prompt)).ok).toBe(true);
    const turns: TurnInput[] = [];
    const turn = async (input: TurnInput) => {
      turns.push(input);
      // The research turn saves its notes, each with a source; the others do nothing, so their checks fail.
      if (input.autopilot?.tools.includes("save_research_note")) {
        for (let i = 0; i < 3; i++) {
          await db().execute(sql`
            insert into commerce.research_notes (store_id, topic, finding, sources) values (${test.id}::uuid, ${`Topic ${i}`}, 'Mugs sell at 300 kr.', ${`{https://example.com/${i}}`}::text[])
          `);
        }
      }
    };
    const complete = async () => ({ text: briefJson({ legalName: "Leire Keramikk AS", postalAddress: "Storgata 1, 0155 Oslo", contactEmail: "hei@leire.no", country: "NO" }), region: null });
    const deps = { complete, connection, turn, draft: async () => ({ ok: false as const, problem: "No AI in tests." }), legalOn: async () => ({ ok: false as const, problems: ["country"] }) };

    await minute(test.id, deps);
    let latest = (await latestDreamRun(test.id))!;
    expect(latest.test).toBe(true);
    expect(latest.steps.brief.status).toBe("done");
    // A test run's yes is pressed by the drill, and counted.
    expect(latest.steps.confirm.status).toBe("done");
    expect(latest.ownerPresses).toBe(2);
    // One AI turn a minute: the research came first.
    expect(turns).toHaveLength(1);
    expect(turns[0].autopilot?.tools).toContain("search_web");
    expect(turns[0].autopilot?.tools).not.toContain("open_store");
    expect(latest.steps.research.status).toBe("done");
    expect(latest.steps.research.detail).toBe("3 research note(s) with a source.");

    // The setup turn sets nothing: its check fails, and after three tries a test run's step fails.
    for (let i = 0; i < 8 && (await latestDreamRun(test.id))!.status !== "failed"; i++) await minute(test.id, deps);
    latest = (await latestDreamRun(test.id))!;
    expect(latest.status).toBe("failed");
    const failed = Object.entries(latest.steps).filter(([, s]) => s.status === "failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every(([, s]) => s.tries === 3)).toBe(true);
    // The legal pages are written for businesses in Norway, Sweden and Denmark; elsewhere the step says so and steps aside.
    expect(["skipped", "waiting"]).toContain(latest.steps.legal.status);
    // A test run never asks for payments: it pays in test mode.
    expect(latest.steps.payments.status === "asking").toBe(false);
  });

  it("switches on Several countries for a brief that sells in more than one, the owner's yes covering it, and holds setup to the brief's countries", async () => {
    const member = (await passMembership(nordic.slug, nordic.owner))!;
    expect((await startDreamRun(member, "Ceramic mugs for Norway and Sweden. Leire Keramikk AS, Storgata 1, 0155 Oslo, hei@leire.no")).ok).toBe(true);
    const business = { legalName: "Leire Keramikk AS", postalAddress: "Storgata 1, 0155 Oslo", contactEmail: "hei@leire.no", country: "NO" };
    const deps = {
      complete: async () => ({ text: briefJson(business, ["NO", "SE"]), region: null }),
      connection,
      // The research turn saves its notes; the setup turn sets nothing.
      turn: async (input: TurnInput) => {
        if (!input.autopilot?.tools.includes("save_research_note")) return;
        for (let i = 0; i < 3; i++) {
          await db().execute(sql`
            insert into commerce.research_notes (store_id, topic, finding, sources) values (${nordic.id}::uuid, ${`Topic ${i}`}, 'Mugs sell at 300 kr.', ${`{https://example.com/${i}}`}::text[])
          `);
        }
      },
      draft: async () => ({ ok: false as const, problem: "No AI in tests." }),
      legalOn: async () => ({ ok: false as const, problems: ["country"] }),
    };
    const setupRan = async () => (await latestDreamRun(nordic.id))!.steps.setup.detail !== undefined;
    for (let i = 0; i < 6 && !(await setupRan()); i++) await minute(nordic.id, deps);
    const latest = (await latestDreamRun(nordic.id))!;
    expect(latest.steps.setup.detail).toBeDefined();
    expect(featureOn((await passMembership(nordic.slug, nordic.owner))!.store, "countries")).toBe(true);
    // The turn set nothing, so the check names what the brief still needs.
    expect(latest.steps.setup.detail).toMatch(/^Still missing: /);
  });

  it("has the AI fix a front page the builder held back, a turn a minute, and makes it the front page once published", async () => {
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, type, slug, draft) values (${real.id}::uuid, 'page', ${`front-${run}`}, '{"title":"Velkommen"}'::jsonb) returning id
    `);
    const pageId = String(page.id);
    const steps = { ...Object.fromEntries(["brief", "confirm", "research", "setup", "brand", "catalogue"].map((id) => [id, { status: "done", tries: 1 }])) };
    const website = { status: "running", tries: 0, ref: pageId, detail: "The AI fixes the front page \"Velkommen\": Picture: no alt text." };
    // The real store's earlier run was stopped: this one carries its brief, with the lanes before the website passed.
    await db().execute(sql`
      insert into commerce.dream_runs (store_id, account_id, prompt, test, steps, brief)
      select store_id, account_id, prompt, true, ${JSON.stringify({ ...steps, website })}::jsonb, brief from commerce.dream_runs where store_id = ${real.id}::uuid and status = 'stopped' limit 1
    `);
    const turns: TurnInput[] = [];
    const deps = {
      complete: async () => ({ text: "{}", region: null }),
      connection,
      // The turn fixes the page and publishes it, as publish_page would once nothing blocks it.
      turn: async (input: TurnInput) => {
        turns.push(input);
        await db().execute(sql`update commerce.pages set published = draft, published_at = now() where id = ${pageId}::uuid`);
      },
      legalOn: async () => ({ ok: false as const, problems: ["country"] }),
    };
    await minute(real.id, deps);
    const latest = (await latestDreamRun(real.id))!;
    expect(turns).toHaveLength(1);
    expect(turns[0].autopilot?.tools).toEqual(["get_page", "edit_page", "publish_page"]);
    expect(turns[0].message).toContain(pageId);
    expect(latest.steps.website).toMatchObject({ status: "done" });
    expect(latest.steps.website.ref).toBeUndefined();
    const [store] = await db().execute<Row>(sql`select front_page_id from commerce.stores where id = ${real.id}::uuid`);
    expect(String(store.front_page_id)).toBe(pageId);
    await stopDreamRun((await passMembership(real.slug, real.owner))!, latest.id);
  });

  it("makes the hand-written starters as drafts when the writer's pages fail its check, and a test run steps aside", async () => {
    const steps = { ...Object.fromEntries(["brief", "confirm", "research", "setup", "brand", "catalogue", "website"].map((id) => [id, { status: "done", tries: 1 }])) };
    const legal = { status: "running", tries: 0, detail: "Writing 2 page(s)." };
    await db().execute(sql`
      insert into commerce.dream_runs (store_id, account_id, prompt, test, steps, brief)
      select store_id, account_id, prompt, true, ${JSON.stringify({ ...steps, legal })}::jsonb, brief from commerce.dream_runs where store_id = ${real.id}::uuid and status = 'stopped' limit 1
    `);
    for (const role of ["terms", "privacy"]) {
      await db().execute(sql`
        insert into commerce.legal_ai_writes (store_id, account_id, role, status, problems) values (${real.id}::uuid, ${real.owner}::uuid, ${role}, 'failed', '["a quote is not word for word"]'::jsonb)
      `);
    }
    const pagesBefore = await db().execute(sql`select 1 from commerce.pages where store_id = ${real.id}::uuid`);
    await minute(real.id, { complete: async () => ({ text: "{}", region: null }), connection, turn: async () => {} });
    const latest = (await latestDreamRun(real.id))!;
    expect(latest.steps.legal.status).toBe("skipped");
    expect(latest.steps.legal.detail).toContain("2 starter page(s) from the store's facts are drafts");
    expect(await db().execute(sql`select 1 from commerce.pages where store_id = ${real.id}::uuid`)).toHaveLength(pagesBefore.length + 2);
    await stopDreamRun((await passMembership(real.slug, real.owner))!, latest.id);
  });

  it("builds another store for an owner from Your stores, and makes none from a description too short", async () => {
    const owner = (await activeAccount(real.owner))!;
    const slug = `another-${run}`;
    expect(await startDreamStore(owner, { name: "Another", slug, prompt: "Too short" })).toMatchObject({ ok: false });
    expect(await db().execute(sql`select 1 from commerce.stores where slug = ${slug}`)).toHaveLength(0);
    const made = await startDreamStore(owner, { name: "Another", slug, prompt: "Linen aprons for cafés in Norway, sewn in Bergen." });
    expect(made).toMatchObject({ ok: true, slug, run: { ok: true } });
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug}`);
    expect(await latestDreamRun(String(store.id))).toMatchObject({ status: "running", test: false, ownerPresses: 1 });
  });
});
