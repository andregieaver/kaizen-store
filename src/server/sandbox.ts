import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { db } from "@/db/client";
import {
  KEEP_HOLD_HOURS,
  SANDBOX_COOKIE,
  SANDBOX_DAYS,
  SANDBOX_MAX_DAYS,
  SANDBOX_PATH,
  SANDBOX_TOUCH_SECONDS,
  formatPass,
  isSandboxId,
  readPass,
  sandboxSlug,
} from "@/lib/sandbox";

import type { AiFeature } from "@/lib/ai-usage";

import { aiFor, type AiConnection } from "./ai";
import { audit, type Account } from "./auth";
import { markDemoContent } from "./demo-content";
import { log } from "./log";
import { removeStoredFiles } from "./media";
import { takeBudget } from "./request-budget";
import { getStore, refreshStoreById, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The page builder's sandbox (D457, `docs/builder-sandbox.md`): a store of its own a visitor edits without an account. Everything about a
 * sandbox goes through here: the platform's switch and cap, making one (`commerce.make_sandbox()`), the pass that opens it
 * (`sandboxFor()`, the only way in for every sandbox page and action), *Start over*, the first change and publish, its AI within its
 * allowance (`sandboxAi()`), and the job that ends sandboxes past their time (`commerce.expire_sandbox()`) and deletes what was in them
 * (`purgeSandbox()`: its library's files, then `commerce.purge_sandbox()`). The pass's secret is never kept; only its SHA-256 is.
 */

export type SandboxSettings = { on: boolean; dailyCap: number; source: string | null };

/** The platform's switch, daily cap and source; off when they cannot be read. */
export async function sandboxSettings(): Promise<SandboxSettings> {
  try {
    const row = await typedRow(
      z.object({ on: col.bool, cap: col.int, source: col.uuid.nullable() }),
      sql`select coalesce(p.sandbox_on, false) as on, coalesce(p.sandbox_daily_cap, 0) as cap, p.sandbox_source as source
            from (select 1) one left join commerce.platform_settings p on true limit 1`,
    );
    return row ? { on: row.on, dailyCap: row.cap, source: row.source } : { on: false, dailyCap: 0, source: null };
  } catch (error) {
    log("error", "sandbox.settings_failed", {}, error);
    return { on: false, dailyCap: 0, source: null };
  }
}

/** Turns the sandbox on or off for everyone (Platform → Access requests), audited. */
export async function setSandboxOn(admin: Account, on: boolean): Promise<void> {
  await db().execute(sql`update commerce.platform_settings set sandbox_on = ${on}`);
  await audit(admin.id, null, "platform.sandbox_set", { on });
}

/** Sandboxes made today (UTC) and open now, for the switch's card. */
export async function sandboxCounts(): Promise<{ today: number; open: number }> {
  const row = await typedRow(
    z.object({ today: col.int, open: col.int }),
    sql`select (select count(*)::int from commerce.sandboxes where created_at >= date_trunc('day', now())) as today,
               (select count(*)::int from commerce.sandboxes where state = 'open') as open`,
  );
  return row ?? { today: 0, open: 0 };
}

const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

function sameHash(kept: string, given: string): boolean {
  const a = Buffer.from(kept, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

export type StartAnswer = { ok: true; id: string; pass: string } | { ok: false; problem: "off" | "busy" | "full" | "failed" };

/**
 * Makes a sandbox for a visitor (the budgets' daily hash of their network): while the switch is on, within the visitor's and the platform's
 * budget (a failed count refuses) and the day's cap. Returns its id and the pass's cookie value; the caller sets the cookie.
 */
export async function startSandbox(visitor: string): Promise<StartAnswer> {
  const settings = await sandboxSettings();
  if (!settings.on) return { ok: false, problem: "off" };
  if (!(await takeBudget(null, "sandbox", visitor))) return { ok: false, problem: "busy" };
  if ((await sandboxCounts()).today >= settings.dailyCap) return { ok: false, problem: "full" };
  const secret = randomBytes(32).toString("base64url");
  let source = settings.source;
  const started = performance.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = sandboxSlug(randomBytes(8));
    try {
      const row = await typedRow(
        z.object({ id: col.uuid }),
        sql`select commerce.make_sandbox(${source}::uuid, ${slug}, ${hashSecret(secret)}, ${SANDBOX_DAYS}) as id`,
      );
      if (!row) return { ok: false, problem: "failed" };
      // What it was copied with is its demo content (D260), so once kept (S2) the owner can take away what they never touched in one
      // press, and keeps every page they made or changed here. Never throws.
      const store = await typedRow(z.object({ store_id: col.uuid }), sql`select store_id from commerce.sandboxes where id = ${row.id}::uuid`);
      if (store) await markDemoContent(store.store_id).catch((error: unknown) => log("warn", "sandbox.demo_mark_failed", {}, error));
      // How long a copy takes decides whether fresh copies should be kept ready (4.8): only past about two seconds.
      log("info", "sandbox.made", { sandboxId: row.id, fromStandard: source === null, ms: Math.round(performance.now() - started) });
      return { ok: true, id: row.id, pass: formatPass({ id: row.id, secret }) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The source chosen on the platform is no longer offered: the Standard store, as a new store would start.
      if (source !== null && message.includes("store_starters.not_offered")) {
        log("warn", "sandbox.source_not_offered", {});
        source = null;
        continue;
      }
      // Eight random letters and digits that another store already has: another draw.
      if (message.includes("stores_slug")) continue;
      log("error", "sandbox.make_failed", {}, error);
      return { ok: false, problem: "failed" };
    }
  }
  return { ok: false, problem: "failed" };
}

/** The pass's cookie: HttpOnly, only on the sandbox's routes, for as long as a sandbox can last. */
export function passCookie(value: string) {
  return {
    name: SANDBOX_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: SANDBOX_PATH,
    maxAge: SANDBOX_MAX_DAYS * 24 * 60 * 60,
  };
}

/** A sandbox as its pages and actions use it: the store, the sandbox account to act as, and its times. */
export type Sandbox = { id: string; store: Store; account: Account; createdAt: string; expiresAt: string };

/** The sandbox account, as an account to act as (versions and saved parts name it); null when it is missing. */
async function sandboxAccount(): Promise<Account | null> {
  const row = await typedRow(
    z.object({ id: col.uuid, email: col.text, name: col.textOrNull }),
    sql`select id, email, name from commerce.accounts where id = commerce.sandbox_account()`,
  );
  return row ? { id: row.id, email: row.email, name: row.name, platformAdmin: false, adminView: "basic" } : null;
}

/**
 * The only way into a sandbox (D457 4.2): the sandbox `id` names, opened by this browser's pass, open and within its time. A visit pushes
 * its time on (at most once a minute): 7 days from now, never past 30 days after it was made. Null for anything else, the same whatever
 * the reason.
 */
export async function sandboxFor(id: unknown): Promise<Sandbox | null> {
  if (!isSandboxId(id)) return null;
  const pass = readPass((await cookies()).get(SANDBOX_COOKIE)?.value);
  if (!pass || pass.id !== id) return null;
  const row = await typedRow(
    z.object({ slug: col.text, pass_hash: col.text, created_at: col.timestamp, expires_at: col.timestamp, stale: col.bool }),
    sql`select s.slug, x.pass_hash, x.created_at, x.expires_at, x.last_seen_at < now() - make_interval(secs => ${SANDBOX_TOUCH_SECONDS}) as stale
          from commerce.sandboxes x join commerce.stores s on s.id = x.store_id
         where x.id = ${id}::uuid and x.state = 'open' and x.expires_at > now() and s.sandbox`,
  );
  if (!row || !sameHash(row.pass_hash, hashSecret(pass.secret))) return null;
  let expiresAt = row.expires_at;
  if (row.stale) {
    const touched = await typedRow(
      z.object({ expires_at: col.timestamp }),
      sql`update commerce.sandboxes
             set last_seen_at = now(),
                 expires_at = least(created_at + make_interval(days => ${SANDBOX_MAX_DAYS}), now() + make_interval(days => ${SANDBOX_DAYS}))
           where id = ${id}::uuid and state = 'open'
       returning expires_at`,
    );
    if (touched) expiresAt = touched.expires_at;
  }
  const [store, account] = await Promise.all([getStore(row.slug), sandboxAccount()]);
  if (!store?.sandbox || store.status !== "active" || !account) return null;
  return { id, store, account, createdAt: row.created_at, expiresAt };
}

/** The sandbox this browser's pass opens, if it is still open: the start screen offers to go back to it. */
export async function currentSandbox(): Promise<Sandbox | null> {
  const pass = readPass((await cookies()).get(SANDBOX_COOKIE)?.value);
  return pass ? sandboxFor(pass.id) : null;
}

/**
 * Whether this browser's pass opens a sandbox that was kept (D457 S2): its page then says the store is the person's now and how to sign in,
 * instead of that it ended.
 */
export async function keptSandbox(id: unknown): Promise<boolean> {
  if (!isSandboxId(id)) return false;
  const pass = readPass((await cookies()).get(SANDBOX_COOKIE)?.value);
  if (!pass || pass.id !== id) return false;
  const row = await typedRow(z.object({ pass_hash: col.text }), sql`select pass_hash from commerce.sandboxes where id = ${id}::uuid and state = 'kept'`);
  return Boolean(row && sameHash(row.pass_hash, hashSecret(pass.secret)));
}

/** A request to keep the sandbox waits for its link to be pressed (D457 S2): the sandbox lasts until then and a day more, 30 days at most. */
export async function holdSandbox(id: string): Promise<void> {
  await db().execute(sql`
    update commerce.sandboxes
       set expires_at = least(created_at + make_interval(days => ${SANDBOX_MAX_DAYS}), greatest(expires_at, now() + make_interval(hours => ${KEEP_HOLD_HOURS})))
     where id = ${id}::uuid and state = 'open'
  `);
}

/** The first change and the first publish in a sandbox, for the funnel; each kept once. */
export async function noteSandboxChange(id: string, published: boolean): Promise<void> {
  await db()
    .execute(sql`
      update commerce.sandboxes
         set first_change_at = coalesce(first_change_at, now()),
             first_publish_at = case when ${published} then coalesce(first_publish_at, now()) else first_publish_at end
       where id = ${id}::uuid and state = 'open' and (first_change_at is null or (${published} and first_publish_at is null))
    `)
    .catch((error: unknown) => log("warn", "sandbox.note_failed", { sandboxId: id }, error));
}

/** Ends one open sandbox: its pass stops working and its store is closed. False when it was not open. */
export async function endSandbox(id: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ ended: col.bool, store_id: col.uuid.nullable() }),
    sql`select commerce.expire_sandbox(${id}::uuid) as ended, (select store_id from commerce.sandboxes where id = ${id}::uuid) as store_id`,
  );
  if (row?.ended && row.store_id) await refreshStoreById(row.store_id);
  return Boolean(row?.ended);
}

/** The five-minute job (`runJobs()`): sandboxes past their time ended, a few hundred a run, each on its own so one cannot stop the rest. */
export async function expireSandboxes(limit = 200): Promise<{ expired: number }> {
  const due = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.sandboxes where state = 'open' and expires_at <= now() order by expires_at limit ${limit}`,
  );
  let expired = 0;
  for (const { id } of due) {
    try {
      if (await endSandbox(id)) expired += 1;
    } catch (error) {
      log("error", "sandbox.expire_failed", { sandboxId: id }, error);
    }
  }
  if (expired > 0) log("info", "sandbox.expired", { count: expired });
  return { expired };
}

/**
 * The sandbox's AI for one feature (4.5): the platform's connection while the sandbox's allowance (`ai_cost_month_micros`, made with it)
 * has room, and within the `sandbox_ai` budget, which counts the calls a price might not (a model with no price set costs nothing in
 * the allowance). Null when either is spent: the feature then says so, with *Keep this store* beside it. The only way a sandbox reaches an
 * AI.
 */
export async function sandboxAi(sandbox: Sandbox, feature: AiFeature): Promise<AiConnection | null> {
  const connection = await aiFor(sandbox.store.id, { feature, accountId: sandbox.account.id });
  if (!connection) return null;
  if (!(await takeBudget(null, "sandbox_ai", sandbox.id))) return null;
  return connection;
}

/** The files of a sandbox's library: only those in its own folder, never the addresses its copied products point at (the source's). */
async function sandboxFiles(storeId: string): Promise<Map<string, string[]>> {
  const rows = await typedRows(
    z.object({ bucket: col.text, path: col.text, thumbnail_path: col.textOrNull }),
    sql`select bucket, path, thumbnail_path from commerce.media where store_id = ${storeId}::uuid and bucket is not null and path is not null`,
  );
  const own = (path: string | null): path is string => Boolean(path?.startsWith(`${storeId}/`));
  const files = new Map<string, string[]>();
  for (const row of rows) {
    const paths = [row.path, row.thumbnail_path].filter(own);
    if (paths.length > 0) files.set(row.bucket, [...(files.get(row.bucket) ?? []), ...paths]);
  }
  return files;
}

/**
 * Deletes what was in an expired sandbox (4.8): its library's files first, then every row of its store (`commerce.purge_sandbox()`), which
 * leaves the bare store as a tombstone and the sandbox's row as the record that it was. When a file cannot be removed nothing is purged,
 * so the next run tries again with the rows that name it. The rows deleted, or null when it was not purged.
 */
export async function purgeSandbox(id: string, deps: { remove?: typeof removeStoredFiles } = {}): Promise<number | null> {
  const row = await typedRow(
    z.object({ store_id: col.uuid }),
    sql`select store_id from commerce.sandboxes where id = ${id}::uuid and state = 'expired'`,
  );
  if (!row) return null;
  const remove = deps.remove ?? removeStoredFiles;
  for (const [bucket, paths] of await sandboxFiles(row.store_id)) {
    for (let i = 0; i < paths.length; i += 500) {
      if (!(await remove(bucket, paths.slice(i, i + 500)))) {
        log("warn", "sandbox.files_left", { sandboxId: id, files: paths.length });
        return null;
      }
    }
  }
  const purged = await typedRow(z.object({ deleted: col.int }), sql`select commerce.purge_sandbox(${id}::uuid) as deleted`);
  await refreshStoreById(row.store_id);
  return purged?.deleted ?? 0;
}

/** Purges expired sandboxes, the longest ended first, a few a run, each on its own so one cannot stop the rest. */
export async function purgeSandboxes(limit = 25, deps: { remove?: typeof removeStoredFiles } = {}): Promise<{ purged: number }> {
  const due = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.sandboxes where state = 'expired' order by ended_at limit ${limit}`,
  );
  let purged = 0;
  for (const { id } of due) {
    try {
      if ((await purgeSandbox(id, deps)) !== null) purged += 1;
    } catch (error) {
      log("error", "sandbox.purge_failed", { sandboxId: id }, error);
    }
  }
  if (purged > 0) log("info", "sandbox.purged", { count: purged });
  return { purged };
}

/** The five-minute job's `sandboxes` step (`runJobs()`): sandboxes past their time ended, then what was in ended ones deleted. */
export async function sandboxJob(): Promise<{ expired: number; purged: number }> {
  const { expired } = await expireSandboxes();
  const { purged } = await purgeSandboxes();
  return { expired, purged };
}

/**
 * The retention rule's step (`runRetention()`, kind `sandboxes`): a sandbox nobody has visited for the rule's period is ended, whatever
 * time it had left, and every ended sandbox is purged. The rule is seeded at `SANDBOX_DAYS`, so it only acts when a platform admin
 * shortens it; the five-minute job does the rest. The number purged.
 */
export async function retireIdleSandboxes(cutoff: string, deps: { remove?: typeof removeStoredFiles } = {}): Promise<number> {
  const idle = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.sandboxes where state = 'open' and last_seen_at < ${cutoff}::timestamptz order by last_seen_at limit 1000`,
  );
  for (const { id } of idle) {
    try {
      await endSandbox(id);
    } catch (error) {
      log("error", "sandbox.expire_failed", { sandboxId: id }, error);
    }
  }
  return (await purgeSandboxes(1000, deps)).purged;
}
