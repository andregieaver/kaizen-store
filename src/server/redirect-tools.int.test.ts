import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { Membership } from "./auth";
import type { AiConnection } from "./ai";
import type { Approval, AssistantEvent } from "./owner-assistant";
import { csvBytes, depsWith, fakeStorage, runToEnd } from "./data-test-support";
import { auditActions, redirectFixture, redirectRowsOf, renameProduct, type RedirectFixture } from "./redirect-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { runOwnerTool, preflightOwnerTool, OwnerToolError } = await import("./owner-tools");
const { recordNotFound, resetNotFoundThrottle } = await import("./not-found");
const assistant = await import("./owner-assistant");
const jobs = await import("./data-jobs");

type Row = Record<string, unknown>;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * The AI manager's redirect tools (D168, `docs/wave-2-redirects.md` 4.8, 5.5), run the way the assistant runs them (`runOwnerTool()`, `preflightOwnerTool()`, a
 * kept call and the owner's yes) against a real store: `redirect_overview` repeats the store's own counts and the 404 report's addresses with the suggestions
 * found in code, shows another store nothing, and answers a member only what the Website keys allow; `add_redirect` is checked before it is kept, adds exactly
 * the redirect the owner said yes to through the form's own service, and is the only write.
 */

let f: RedirectFixture;
let other: RedirectFixture;

const holder = (m: Membership) => ({ role: m.role, kind: m.kind, permissions: m.permissions });
const ctxOf = (m: Membership) => ({ account: m.account, store: m.store, invalidate: () => {}, holder: holder(m) });
const run = (m: Membership, name: string, input: unknown = {}) => runOwnerTool(ctxOf(m), name, input) as Promise<Answer>;
const preflight = (m: Membership, name: string, input: unknown) => preflightOwnerTool(ctxOf(m), name, input);

/** Asks `n` times for an address, a second and a half apart (the throttle is one write a second per address and instance). */
async function ask(fx: RedirectFixture, path: string, n: number, crawler = false, t0 = 5_000_000): Promise<void> {
  for (let i = 0; i < n; i += 1) await recordNotFound(fx.fx.storeId, path, crawler, t0 + i * 1_500);
}

beforeAll(async () => {
  f = await redirectFixture("aitools");
  other = await redirectFixture("aitools-other");
});

afterEach(() => {
  resetNotFoundThrottle();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_approvals where store_id = ${f.fx.storeId}::uuid`);
  await db().execute(sql`delete from commerce.assistant_conversations where store_id = ${f.fx.storeId}::uuid`);
  await closeDb();
});

describe("redirect_overview", () => {
  it("answers a store with nothing recorded with its counts and what is missing, never a zero that reads as 'nothing is broken'", async () => {
    const out = await run(f.owner, "redirect_overview");
    expect(out.redirects).toEqual({
      manual: 0,
      manual_limit: 100_000,
      manual_left: 100_000,
      automatic_for_products: 0,
      automatic_for_categories: 0,
      automatic_for_tags: 0,
      for_pages: 0,
      for_articles: 0,
      total: 0,
    });
    expect(out.missing).toMatchObject({ window_days: 30, addresses_in_window: 0, shown: 0, addresses: [] });
    expect(out.notes.join("\n")).toMatch(/does not prove that no link is broken/);
    expect(out.pages).toEqual({ redirects: `/admin/${f.fx.slug}/redirects`, missing_addresses: `/admin/${f.fx.slug}/redirects/404s`, import: `/admin/${f.fx.slug}/redirects/import` });
  });

  it("lists the missing addresses most asked first, with the report's suggestions, as lower bounds, and counts the redirects the store made itself", async () => {
    await ask(f, "/collections/" + f.category.slug, 5);
    await ask(f, "/products/" + f.product.handle, 3, true, 6_000_000);
    await ask(f, "/pages/nothing-like-it-xyz", 1, false, 7_000_000);
    // Renaming a product and a category makes the store's own redirects, which the counts say.
    await renameProduct(f.fx.storeId, f.product.id, `${f.product.handle}-ny`);
    const out = await run(f.owner, "redirect_overview", { days: 7, limit: 10 });
    expect(out.redirects).toMatchObject({ manual: 0, automatic_for_products: 1, total: 1 });
    expect(out.missing.window_days).toBe(7);
    const [first, second, third] = out.missing.addresses;
    expect([first.address, second.address, third.address]).toEqual([`/collections/${f.category.slug}`, `/products/${f.product.handle}`, "/pages/nothing-like-it-xyz"]);
    expect(first.requests_at_least).toBe(5);
    expect(first.suggested_targets[0]).toMatchObject({ address: `/category/${f.category.slug}`, kind: "category" });
    expect(second.requests_at_least).toBe(3);
    expect(second.of_which_robots_at_least).toBe(3);
    // The address of the renamed product is now a redirect of the store's own, so it is no longer an address it could not find: the suggestion is its new home.
    expect(second.suggested_targets.map((s: Answer) => s.address)).toContain(`/p/${f.product.handle}-ny`);
    expect(third.suggested_targets).toEqual([]);
    expect(third.no_suggestion).toMatch(/ask the owner/);
    expect(out.notes.join("\n")).toMatch(/at least what happened/);
  });

  it("cuts the list to the limit asked and takes the window as 7, 30 or 90 days only", async () => {
    const out = await run(f.owner, "redirect_overview", { limit: 2 });
    expect(out.missing.shown).toBe(2);
    expect(out.missing.addresses_in_window).toBeGreaterThanOrEqual(3);
    await expect(run(f.owner, "redirect_overview", { days: 14 })).rejects.toThrow(/could not be read/);
    await expect(run(f.owner, "redirect_overview", { limit: 0 })).rejects.toBeInstanceOf(OwnerToolError);
  });

  it("shows another store nothing of this one, and this one nothing of the other", async () => {
    await ask(other, "/collections/only-in-the-other-store", 4, false, 9_000_000);
    const mine = await run(f.owner, "redirect_overview", { limit: 20 });
    expect(JSON.stringify(mine)).not.toContain("only-in-the-other-store");
    const theirs = await run(other.owner, "redirect_overview", { limit: 20 });
    expect(theirs.missing.addresses.map((a: Answer) => a.address)).toEqual(["/collections/only-in-the-other-store"]);
    expect(theirs.redirects.total).toBe(0);
  });

  it("answers a member with the read key and refuses one without it, in words", async () => {
    const out = await run(f.reader, "redirect_overview");
    expect(out.redirects.total).toBeGreaterThanOrEqual(1);
    await expect(run(f.outsider, "redirect_overview")).rejects.toThrow(/your role has no access to website/i);
  });

  it("leaves out an address that has a redirect now: the list is what still needs one", async () => {
    await ask(f, "/collections/old-shoes", 2, false, 11_000_000);
    expect((await run(f.owner, "redirect_overview", { limit: 20 })).missing.addresses.map((a: Answer) => a.address)).toContain("/collections/old-shoes");
    await run(f.owner, "add_redirect", { from: "/collections/old-shoes", to: `/category/${f.category.slug}` });
    expect((await run(f.owner, "redirect_overview", { limit: 20 })).missing.addresses.map((a: Answer) => a.address)).not.toContain("/collections/old-shoes");
  });
});

describe("add_redirect", () => {
  it("is checked before it is kept: a live page, a working page, another website, a loop and a repeat are refused now, in the form's words", async () => {
    const refuse = (from: string, to: string, pattern: RegExp) => expect(preflight(f.owner, "add_redirect", { from, to }), `${from} -> ${to}`).rejects.toThrow(pattern);
    await refuse("/om-oss", "/p/x", /live|page/i);
    await refuse("/cart", "/p/x", /working page|reserved|cannot/i);
    await refuse("/old-thing", "https://example.com/elsewhere", /another website|external/i);
    await refuse("/old-thing", "/old-thing", /itself|same/i);
    await refuse("", "/p/x", /could not be read/);
    await run(f.owner, "add_redirect", { from: "/loop-a", to: "/loop-b" });
    await refuse("/loop-b", "/loop-a", /loop/i);
    await refuse("/loop-a", "/loop-b", /already a redirect from \/loop-a to \/loop-b/);
    await expect(preflight(f.owner, "add_redirect", { from: "/fresh-address", to: `/category/${f.category.slug}` })).resolves.toBeUndefined();
    expect((await redirectRowsOf(f.fx.storeId)).some((r) => r.source === "/fresh-address")).toBe(false);
  });

  it("refuses at once what the member's role may not do, and never reaches the write", async () => {
    await expect(preflight(f.reader, "add_redirect", { from: "/x-reader", to: "/p/a" })).rejects.toThrow(/no access to website/i);
    await expect(run(f.reader, "add_redirect", { from: "/x-reader", to: "/p/a" })).rejects.toThrow(/no access to website/i);
    await expect(run(f.outsider, "add_redirect", { from: "/x-outsider", to: "/p/a" })).rejects.toBeInstanceOf(OwnerToolError);
    const rows = await redirectRowsOf(f.fx.storeId);
    expect(rows.some((r) => r.source === "/x-reader" || r.source === "/x-outsider")).toBe(false);
  });

  it("adds the redirect through the service with origin assistant, in the normal form, and writes the two audit entries", async () => {
    const out = await run(f.owner, "add_redirect", { from: "/Collections/Winter-Boots/", to: `/p/${f.product.handle}-ny` });
    expect(out.done).toBe(`Added the redirect from /collections/winter-boots to /p/${f.product.handle}-ny: it applies in every country and language, and is permanent (308).`);
    expect(out).toMatchObject({ from: "/collections/winter-boots", to: `/p/${f.product.handle}-ny`, admin: `/admin/${f.fx.slug}/redirects` });
    const row = (await redirectRowsOf(f.fx.storeId)).find((r) => r.source === "/collections/winter-boots");
    expect(row).toMatchObject({ kind: "manual", target: `/p/${f.product.handle}-ny`, origin: "assistant" });
    expect((await auditActions(f.fx.storeId, "redirect.")).map((a) => a.action)).toContain("redirect.created");
    const [gated] = await db().execute<Row>(sql`select action, details from commerce.audit_log where store_id = ${f.fx.storeId}::uuid and action = 'store.assistant.add_redirect' order by id desc limit 1`);
    expect(gated).toBeTruthy();
    expect(JSON.stringify(gated.details).toLowerCase()).toContain("winter-boots");
  });

  it("repeats a warning (a target that is no live page now) instead of hiding it, and a second call for the same pair says it was already there", async () => {
    const warned = await run(f.owner, "add_redirect", { from: "/to-nowhere-yet", to: "/will-exist-later" });
    expect(warned.notes.join(" ")).toMatch(/is not a page on this store now/);
    const again = await run(f.owner, "add_redirect", { from: "/to-nowhere-yet", to: "/will-exist-later" });
    expect(again.done).toMatch(/was already there/);
  });

  it("stores the final destination when the target is itself redirected, and says so", async () => {
    await run(f.owner, "add_redirect", { from: "/hop-one", to: `/category/${f.category.slug}` });
    const out = await run(f.owner, "add_redirect", { from: "/hop-two", to: "/hop-one" });
    expect(out.to).toBe(`/category/${f.category.slug}`);
    expect(out.notes.join(" ")).toMatch(/redirected|final/i);
  });

  it("holds the service's refusal when the store changed after the call was kept: a live page taken since is refused at the write", async () => {
    const checked = await preflight(f.owner, "add_redirect", { from: "/late-page", to: `/category/${f.category.slug}` });
    expect(checked).toBeUndefined();
    await db().execute(sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${f.fx.storeId}::uuid, 'late-page', '{"title":"Late","rows":[]}'::jsonb, '{"title":"Late","rows":[]}'::jsonb, now())
    `);
    await expect(run(f.owner, "add_redirect", { from: "/late-page", to: `/category/${f.category.slug}` })).rejects.toBeInstanceOf(OwnerToolError);
    expect((await redirectRowsOf(f.fx.storeId)).some((r) => r.source === "/late-page")).toBe(false);
  });
});

describe("a call kept for the owner's yes, in a turn of the assistant", () => {
  const connection = { provider: "openai", apiUrl: "https://ai.example/v1", apiKey: "sk-test", textModel: "text-model", textEuOnly: false, zeroDataRetention: false } as unknown as AiConnection;
  const sse = (chunks: unknown[]) => new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  const says = (text: string) => sse(text.match(/[\s\S]{1,7}/g)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })));
  const calls = (name: string, args: unknown) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-0", function: { name, arguments: JSON.stringify(args) } }] } }] }]);
  const fakeModel = (...answers: Response[]) => {
    const requests: { messages: { role: string; content: string | null }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return answers.shift() ?? says("(no more answers)");
      }),
    );
    return requests;
  };
  const turn = async (message: string) => {
    const events: AssistantEvent[] = [];
    await assistant.runTurn({ member: f.owner, conversationId: null, message, emit: (e) => events.push(e), invalidate: () => {}, connection });
    return events;
  };

  it("is described in words made from the arguments, runs only on a yes, and adds nothing before it", async () => {
    fakeModel(calls("add_redirect", { from: "/collections/summer-sale", to: `/category/${f.category.slug}` }), says("Venter på ditt ja."));
    const events = await turn("Send /collections/summer-sale til kategorien");
    const queued = (events.find((e) => e.type === "approval") as { approval: Approval } | undefined)?.approval;
    expect(queued).toMatchObject({ tool: "add_redirect", category: "public", status: "pending" });
    expect(queued!.summary).toBe(`Redirect /collections/summer-sale to /category/${f.category.slug} in every country, as a permanent redirect (308).`);
    expect((await redirectRowsOf(f.fx.storeId)).some((r) => r.source === "/collections/summer-sale")).toBe(false);
    const decided = await assistant.decideApproval(f.owner, queued!.id, true, () => {});
    expect(decided).toMatchObject({ status: "done" });
    expect((await redirectRowsOf(f.fx.storeId)).find((r) => r.source === "/collections/summer-sale")).toMatchObject({ kind: "manual", origin: "assistant", target: `/category/${f.category.slug}` });
  });

  it("adds nothing on a no", async () => {
    fakeModel(calls("add_redirect", { from: "/collections/declined", to: `/category/${f.category.slug}` }), says("Greit."));
    const events = await turn("Send /collections/declined til kategorien");
    const queued = (events.find((e) => e.type === "approval") as { approval: Approval }).approval;
    await assistant.decideApproval(f.owner, queued.id, false, () => {});
    expect((await redirectRowsOf(f.fx.storeId)).some((r) => r.source === "/collections/declined")).toBe(false);
  });

  it("is never kept when it could not be done: the model is told why and the owner is asked nothing", async () => {
    const requests = fakeModel(calls("add_redirect", { from: "/om-oss", to: `/category/${f.category.slug}` }), says("Den siden finnes."));
    const events = await turn("Send /om-oss videre");
    expect(events.some((e) => e.type === "approval")).toBe(false);
    expect(JSON.stringify(requests.at(-1)!.messages)).toMatch(/live|page/i);
  });
});

describe("list_data_jobs with the redirect jobs", () => {
  // Custom roles with the products read key (the tool's own) and the website keys the redirect jobs ask: an import is the write key's, a file made by an export the read key's.
  // A website-only role cannot use the tool at all (it asks the products key, like the page it stands beside).
  let jobsReader: Membership;
  let jobsWriter: Membership;
  const member = async (label: string, permissions: string[]): Promise<Membership> => {
    const email = `${label}-${f.fx.slug}@example.com`;
    const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, ${label}) returning id`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${f.fx.storeId}::uuid, ${String(row.id)}::uuid, 'admin')`);
    return { account: { id: String(row.id), email, name: label, platformAdmin: false }, store: f.owner.store, role: "admin", permissions };
  };
  beforeAll(async () => {
    jobsReader = await member("jobsreader", ["products:read", "website:read"]);
    jobsWriter = await member("jobswriter", ["products:read", "website:read", "website:write"]);
  });

  it("lists a redirect import and a redirect export for a member who may use them, with the counts that mean something for redirects", async () => {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const bytes = csvBytes([["Redirect from", "Redirect to"], ["/jobs-a", `/category/${f.category.slug}`], ["/jobs-b", "/jobs-a"]]);
    const started = await jobs.startRedirectUpload(f.owner, "redirects.csv", deps);
    if (!started.ok) throw new Error(started.problem);
    storage.files.set(`imports/${started.path}`, bytes);
    const registered = await jobs.registerRedirectImport(f.owner, { path: started.path, name: "redirects.csv" }, deps);
    if (!registered.ok) throw new Error(registered.problems.join(" "));
    const check = await jobs.startRedirectCheck(f.owner, registered.jobId, {}, deps);
    if (!check.ok) throw new Error(check.problem);
    await runToEnd(registered.jobId, deps);
    const apply = await jobs.startRedirectApply(f.owner, registered.jobId, deps);
    if (!apply.ok) throw new Error(apply.problem);
    expect(await runToEnd(registered.jobId, deps)).toBe("done");
    await db().execute(sql`select commerce.start_export_job(${f.fx.storeId}::uuid, 'redirect_export', ${f.owner.account.id}::uuid, '{}'::jsonb, 3)`);

    const out = await run(jobsWriter, "list_data_jobs", {});
    expect(out.shown_kinds).toEqual(expect.arrayContaining(["redirect_import", "redirect_export"]));
    const imported = out.jobs.find((j: Answer) => j.kind_code === "redirect_import");
    expect(imported).toMatchObject({ kind: "Redirect import", status_code: "done", page: `/admin/${f.fx.slug}/redirects/import/${registered.jobId}` });
    expect(imported.counts).toMatchObject({ created: 2 });
    for (const meaningless of ["saved_as_draft", "prices_changed", "pictures_fetched"]) expect(imported.counts).not.toHaveProperty(meaningless);
    expect(out.jobs.find((j: Answer) => j.kind_code === "redirect_export")).toMatchObject({ kind: "Redirect file" });
    // Never a file's name, path or an address from it.
    expect(JSON.stringify(out)).not.toMatch(/redirects\.csv|jobs-a|imports\//);

    // The read key sees the file an export made, not the import (which is the write key's).
    const read = await run(jobsReader, "list_data_jobs", {});
    expect(read.shown_kinds).toContain("redirect_export");
    expect(read.shown_kinds).not.toContain("redirect_import");
    await expect(run(jobsReader, "list_data_jobs", { kind: "redirect_import" })).rejects.toThrow(/no access to the website's redirects/);
  });

  it("shows a member's role only the kinds it may use, and refuses a redirect kind to a role with no website key, in words", async () => {
    await expect(run(f.outsider, "list_data_jobs", { kind: "redirect_export" })).rejects.toThrow(/no access to the website's redirects/);
    const everything = await run(f.outsider, "list_data_jobs", {});
    expect(everything.shown_kinds).not.toContain("redirect_import");
    expect(everything.shown_kinds).not.toContain("redirect_export");
    expect(everything.jobs.every((j: Answer) => !String(j.kind_code).startsWith("redirect"))).toBe(true);
  });
});
