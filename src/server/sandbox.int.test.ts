import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { SANDBOX_COOKIE, readPass } from "@/lib/sandbox";
import { newPageContent } from "@/lib/page-content";

/**
 * The page builder's sandbox (D457) against a real database: the switch, the budget and the cap; a store made from the Standard store,
 * private and the sandbox account's; the pass that opens it and nothing else; a visit pushing its time on; saving a page as the sandbox
 * account; no email of any kind; a sandbox ended by Start over or by its time; and a sandbox left out of the grid's stores. Step S3: its
 * allowances (storage and AI) and the AI's budget, its AI routes opened only by the pass, and the purge (its own files only, then every
 * row of its store) by the job and by the retention rule.
 */
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (cookie: { name: string; value: string }) => jar.set(cookie.name, cookie.value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const sandbox = await import("./sandbox");
const pages = await import("./pages");
const { sendEmail } = await import("./email");
const { listGridStores } = await import("./content-grid");
const signup = await import("./self-signup");
const limits = await import("./limits");
const sandboxAi = await import("./sandbox-ai");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");

type Row = Record<string, unknown>;
const RUN = Date.now().toString(36);
let was: { on: boolean; cap: number };

async function setSwitch(on: boolean, cap = 300): Promise<void> {
  await db().execute(sql`update commerce.platform_settings set sandbox_on = ${on}, sandbox_daily_cap = ${cap}`);
}

/** A sandbox made for a visitor of its own, its pass in the jar. */
async function made(tag: string): Promise<{ id: string; pass: string }> {
  const started = await sandbox.startSandbox(`visitor-${tag}-${RUN}`);
  if (!started.ok) throw new Error(`no sandbox: ${started.problem}`);
  jar.set(SANDBOX_COOKIE, started.pass);
  return started;
}

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`select sandbox_on, sandbox_daily_cap from commerce.platform_settings`);
  was = { on: Boolean(row?.sandbox_on), cap: Number(row?.sandbox_daily_cap ?? 300) };
  await setSwitch(true, 10000);
});

afterAll(async () => {
  await setSwitch(was.on, was.cap);
  await closeDb();
});

describe("starting a sandbox (D457)", () => {
  it("makes none while the switch is off", async () => {
    await setSwitch(false);
    expect(await sandbox.startSandbox(`off-${RUN}`)).toEqual({ ok: false, problem: "off" });
    await setSwitch(true, 10000);
  });

  it("copies the Standard store into a private store of the sandbox account, at a try- address", async () => {
    const { id, pass } = await made("copy");
    expect(readPass(pass)?.id).toBe(id);
    const [row] = await db().execute<Row>(sql`
      select s.slug, s.sandbox, s.private_mode, s.status, commerce.store_is_active(s.id) as active, x.state,
             (select count(*)::int from commerce.pages p where p.store_id = s.id) as pages,
             (select array_agg(m.account_id) from commerce.store_members m where m.store_id = s.id) = array[commerce.sandbox_account()] as owned,
             x.source_store_id = (select id from commerce.stores where is_template) as from_standard
        from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = ${id}::uuid`);
    expect(row).toMatchObject({ sandbox: true, private_mode: true, status: "active", active: false, state: "open", owned: true, from_standard: true });
    expect(String(row.slug)).toMatch(/^try-[a-z0-9]{8}$/);
    expect(Number(row.pages)).toBeGreaterThan(0);
  });

  it("keeps a visitor to five an hour, and the platform to its cap a day", async () => {
    const visitor = `budget-${RUN}`;
    for (let i = 0; i < 5; i++) expect((await sandbox.startSandbox(visitor)).ok).toBe(true);
    expect(await sandbox.startSandbox(visitor)).toEqual({ ok: false, problem: "busy" });
    const { today } = await sandbox.sandboxCounts();
    await setSwitch(true, today);
    expect(await sandbox.startSandbox(`cap-${RUN}`)).toEqual({ ok: false, problem: "full" });
    await setSwitch(true, 10000);
  });
});

describe("the pass", () => {
  it("opens its own sandbox and nothing else", async () => {
    const first = await made("first");
    const opened = await sandbox.sandboxFor(first.id);
    expect(opened?.store.sandbox).toBe(true);
    expect(opened?.account.email).toBe("sandbox@kaizenaflow.invalid");
    const second = await made("second");
    expect(await sandbox.sandboxFor(first.id)).toBeNull();
    expect(await sandbox.sandboxFor(second.id)).not.toBeNull();
    jar.set(SANDBOX_COOKIE, `${second.id}.${"B".repeat(43)}`);
    expect(await sandbox.sandboxFor(second.id)).toBeNull();
    jar.delete(SANDBOX_COOKIE);
    expect(await sandbox.sandboxFor(second.id)).toBeNull();
    expect(await sandbox.sandboxFor("not-an-id")).toBeNull();
  });

  it("pushes the sandbox's time on at a visit, 7 days from now", async () => {
    const { id } = await made("touch");
    await db().execute(sql`update commerce.sandboxes set last_seen_at = now() - interval '2 minutes', expires_at = now() + interval '1 day' where id = ${id}::uuid`);
    const opened = await sandbox.sandboxFor(id);
    const days = (new Date(opened!.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });
});

describe("working in a sandbox", () => {
  it("saves and publishes a page as the sandbox account, and keeps the first change and publish once", async () => {
    const { id } = await made("save");
    const opened = await sandbox.sandboxFor(id);
    const saved = await pages.savePage(opened!.account, opened!.store.id, null, { ...newPageContent(), title: "Om oss", slug: `om-oss-${RUN}`, rows: [] } as never, { publish: true });
    expect(saved.ok).toBe(true);
    await sandbox.noteSandboxChange(id, true);
    const [first] = await db().execute<Row>(sql`select first_change_at, first_publish_at from commerce.sandboxes where id = ${id}::uuid`);
    expect(first.first_change_at).not.toBeNull();
    expect(first.first_publish_at).not.toBeNull();
    await sandbox.noteSandboxChange(id, true);
    const [again] = await db().execute<Row>(sql`select first_change_at, first_publish_at from commerce.sandboxes where id = ${id}::uuid`);
    expect(again).toEqual(first);
  });

  it("sends no email of any kind", async () => {
    const { id } = await made("email");
    const opened = await sandbox.sandboxFor(id);
    for (const kind of ["order.shipped", "staff.new_order", "newsletter.confirm"]) {
      const outcome = await sendEmail({ storeId: opened!.store.id, kind, to: "someone@example.com", email: { subject: "Hi", html: "<p>Hi</p>", text: "Hi" }, fromName: "Shop", idempotencyKey: `sandbox-${kind}-${RUN}` });
      expect(outcome).toBe("suppressed");
    }
  });

  it("is never one of the stores a grid can show products of", async () => {
    const { id } = await made("grid");
    const opened = await sandbox.sandboxFor(id);
    expect((await listGridStores()).map((s) => s.id)).not.toContain(opened!.store.id);
  });
});

describe("ending a sandbox", () => {
  it("closes it at Start over: the pass no longer opens it", async () => {
    const { id } = await made("over");
    expect(await sandbox.endSandbox(id)).toBe(true);
    expect(await sandbox.sandboxFor(id)).toBeNull();
    expect(await sandbox.endSandbox(id)).toBe(false);
    const [row] = await db().execute<Row>(sql`select s.status, x.state from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = ${id}::uuid`);
    expect(row).toEqual({ status: "closed", state: "expired" });
  });

  it("ends those past their time in the five-minute job", async () => {
    const { id } = await made("late");
    await db().execute(sql`update commerce.sandboxes set expires_at = now() - interval '1 minute' where id = ${id}::uuid`);
    expect(await sandbox.sandboxFor(id)).toBeNull();
    const { expired } = await sandbox.expireSandboxes();
    expect(expired).toBeGreaterThanOrEqual(1);
    const [row] = await db().execute<Row>(sql`select state from commerce.sandboxes where id = ${id}::uuid`);
    expect(row.state).toBe("expired");
  });
});

describe("keeping a sandbox (D457 S2)", () => {
  /** A keep request for the sandbox as its form sends it, with self-serve sign-up on; the link's token, as the email hands it over. */
  async function keep(id: string, email: string, storeName: string): Promise<string> {
    await db().execute(sql`update commerce.platform_settings set self_serve_signup = true`);
    let token = "";
    await signup.startSelfSignup(
      { name: "Kari", email, storeName, message: "", lang: "en", termsAccepted: true, sandboxId: id },
      `10.9.0.1-${RUN}-${email}`,
      { onToken: (t) => (token = t) },
    );
    await sandbox.holdSandbox(id);
    return token;
  }

  it("holds the sandbox while the link waits, then hands the store over at the press, with a trial", async () => {
    const { id } = await made("keep");
    const opened = await sandbox.sandboxFor(id);
    const email = `kari-${RUN}@example.com`;
    const token = await keep(id, email, `Kari Keramikk ${RUN}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [held] = await db().execute<Row>(sql`select expires_at > now() + interval '47 hours' as held from commerce.sandboxes where id = ${id}::uuid`);
    expect(held.held).toBe(true);
    const done = await signup.confirmSelfSignup(token);
    expect(done).toMatchObject({ ok: true });
    const [row] = await db().execute<Row>(sql`
      select s.id, s.slug, s.name, s.sandbox, s.private_mode, x.state, b.trial_ends_at is not null as trial,
             (select array_agg(a.email) from commerce.store_members m join commerce.accounts a on a.id = m.account_id where m.store_id = s.id) as members,
             (select count(*)::int from commerce.store_demo_items d where d.store_id = s.id) as demo_items
        from commerce.sandboxes x join commerce.stores s on s.id = x.store_id
        left join commerce.store_billing b on b.store_id = s.id
       where x.id = ${id}::uuid`);
    expect(row).toMatchObject({ id: opened!.store.id, name: `Kari Keramikk ${RUN}`, sandbox: false, private_mode: true, state: "kept", trial: true, members: [email] });
    expect(String(row.slug)).toBe(`kari-keramikk-${RUN}`);
    // What it was copied with is marked as demo content, so the owner can take away what they never touched.
    expect(Number(row.demo_items)).toBeGreaterThan(0);
    // The browser that built it is told it is theirs now, and the sandbox no longer opens.
    expect(await sandbox.sandboxFor(id)).toBeNull();
    expect(await sandbox.keptSandbox(id)).toBe(true);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${String(row.id)}::uuid and action = 'store.sandbox_kept'`);
    expect(Number(audited.n)).toBe(1);
  });

  it("makes a store the usual way when the sandbox ended before the press", async () => {
    const { id } = await made("ended-keep");
    const opened = await sandbox.sandboxFor(id);
    const email = `late-${RUN}@example.com`;
    const token = await keep(id, email, `Late Shop ${RUN}`);
    expect(await sandbox.endSandbox(id)).toBe(true);
    expect(await signup.confirmSelfSignup(token)).toMatchObject({ ok: true });
    const [request] = await db().execute<Row>(sql`select store_id, status from commerce.access_requests where lower(email) = lower(${email})`);
    expect(request.status).toBe("approved");
    expect(String(request.store_id)).not.toBe(opened!.store.id);
    const [state] = await db().execute<Row>(sql`select state from commerce.sandboxes where id = ${id}::uuid`);
    expect(state.state).toBe("expired");
  });

  it("never names a sandbox that is not open on a new request", async () => {
    const { id } = await made("closed-name");
    await sandbox.endSandbox(id);
    const email = `closed-${RUN}@example.com`;
    await keep(id, email, `Closed ${RUN}`);
    const [request] = await db().execute<Row>(sql`select sandbox_id from commerce.access_requests where lower(email) = lower(${email})`);
    expect(request.sandbox_id).toBeNull();
  });
});

describe("a sandbox's allowances (D457 S3)", () => {
  it("holds its uploads to its storage, as any store's", async () => {
    const { id } = await made("storage");
    const opened = await sandbox.sandboxFor(id);
    const store = opened!.store.id;
    expect(await limits.storageRefusal(store, 1_000_000)).toBeNull();
    expect(await limits.storageRefusal(store, 60_000_000)).toMatch(/./);
  });

  it("gives the AI only while its allowance has room, and only so many calls an hour", async () => {
    const [had] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ai_providers where store_id is null`);
    const added = Number(had.n) === 0;
    if (added) {
      await db().execute(sql`
        insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, enabled, text_model)
        values (null, 'openai', ${encryptSecret("sk-test", parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!)}, 'test', true, 'text-a')`);
    }
    try {
      const { id } = await made("ai");
      const opened = (await sandbox.sandboxFor(id))!;
      expect(await sandbox.sandboxAi(opened, "page_change")).not.toBeNull();
      // Spent: the allowance at nothing (as a month's cost past it would be).
      await db().execute(sql`update commerce.limit_overrides set value = 0 where store_id = ${opened.store.id}::uuid and key = 'ai_cost_month_micros'`);
      limits.forgetLimits(opened.store.id);
      expect(await sandbox.sandboxAi(opened, "page_change")).toBeNull();
      const spent = await sandboxAi.sandboxChangeRequest(
        new Request("http://localhost/admin/try/x/ai/change", { method: "POST", body: JSON.stringify({ type: "page", content: "{}", description: "Make it calmer" }) }),
        id,
      );
      expect(spent.status).toBe(400);
      expect(await spent.json()).toEqual({ ok: false, problem: "The AI in this sandbox is used up. Keep this store to go on using it." });
      // With room again, twenty calls an hour, then none.
      await db().execute(sql`update commerce.limit_overrides set value = 500000 where store_id = ${opened.store.id}::uuid and key = 'ai_cost_month_micros'`);
      limits.forgetLimits(opened.store.id);
      let given = 0;
      for (let i = 0; i < 21; i++) if (await sandbox.sandboxAi(opened, "page_motion")) given += 1;
      expect(given).toBe(19);
    } finally {
      if (added) await db().execute(sql`delete from commerce.ai_providers where store_id is null`);
    }
  });

  it("answers its AI routes only through the pass, and only from its own pages", async () => {
    const { id } = await made("route");
    const ask = (headers: Record<string, string> = {}) =>
      sandboxAi.sandboxPictureRequest(new Request("http://localhost/x", { method: "POST", headers, body: JSON.stringify({ brief: "A calm shop" }) }), id);
    expect((await ask({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    jar.delete(SANDBOX_COOKIE);
    expect((await ask()).status).toBe(404);
  });
});

describe("purging a sandbox (D457 S3)", () => {
  /** A picture in the sandbox's own folder, and a row naming a file of another store's (as a copied product's address would). */
  async function pictures(store: string): Promise<void> {
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, thumbnail_path, file_name, content_type, size_bytes) values
        (${store}::uuid, 'image', ${`https://example.com/${store}/own-${RUN}.webp`}, 'product-images', ${`${store}/own-${RUN}.webp`}, ${`${store}/own-${RUN}-480.webp`}, 'own.webp', 'image/webp', 10),
        (${store}::uuid, 'image', ${`https://example.com/other/${store}-${RUN}.webp`}, 'product-images', ${`other/${store}-${RUN}.webp`}, null, 'other.webp', 'image/webp', 10)`);
  }

  it("removes its own files, then every row of its store, and leaves a bare tombstone", async () => {
    const { id } = await made("purge");
    const store = (await sandbox.sandboxFor(id))!.store.id;
    await pictures(store);
    expect(await sandbox.purgeSandbox(id)).toBeNull();
    await sandbox.endSandbox(id);
    const removed: [string, string[]][] = [];
    // A file that cannot be removed purges nothing, so the next run tries again with the rows that name it.
    expect(await sandbox.purgeSandbox(id, { remove: async () => false })).toBeNull();
    const [kept] = await db().execute<Row>(sql`select state, (select count(*)::int from commerce.pages where store_id = ${store}::uuid) as pages from commerce.sandboxes where id = ${id}::uuid`);
    expect(kept.state).toBe("expired");
    expect(Number(kept.pages)).toBeGreaterThan(0);
    const deleted = await sandbox.purgeSandbox(id, { remove: async (bucket, paths) => (removed.push([bucket, paths]), true) });
    expect(deleted).toBeGreaterThan(10);
    expect(removed).toEqual([["product-images", [`${store}/own-${RUN}.webp`, `${store}/own-${RUN}-480.webp`]]]);
    const [row] = await db().execute<Row>(sql`
      select x.state, x.purged_at is not null as purged, s.status, s.custom_css,
             (select count(*)::int from commerce.pages where store_id = s.id) as pages,
             (select count(*)::int from commerce.store_members where store_id = s.id) as members,
             (select count(*)::int from commerce.media where store_id = s.id) as media,
             (select count(*)::int from commerce.audit_log where store_id = s.id) as audit
        from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = ${id}::uuid`);
    expect(row).toEqual({ state: "purged", purged: true, status: "closed", custom_css: "", pages: 0, members: 0, media: 0, audit: 0 });
    expect(await sandbox.purgeSandbox(id)).toBeNull();
  });

  it("purges ended sandboxes in the five-minute job's step, and idle ones by the retention rule", async () => {
    const remove = async () => true;
    const { id: ended } = await made("job");
    await sandbox.endSandbox(ended);
    expect((await sandbox.purgeSandboxes(1000, { remove })).purged).toBeGreaterThanOrEqual(1);
    const { id: idle } = await made("idle");
    await db().execute(sql`update commerce.sandboxes set last_seen_at = now() - interval '3 days' where id = ${idle}::uuid`);
    // The rule's period shortened to two days: the sandbox visited three days ago goes, whatever time it had left.
    expect(await sandbox.retireIdleSandboxes(new Date(Date.now() - 2 * 86_400_000).toISOString(), { remove })).toBeGreaterThanOrEqual(1);
    const rows = await db().execute<Row>(sql`select id, state from commerce.sandboxes where id in (${ended}::uuid, ${idle}::uuid) order by created_at`);
    expect(rows.map((r) => r.state)).toEqual(["purged", "purged"]);
  });
});
