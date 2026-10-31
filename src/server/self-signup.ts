import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag, updateTag } from "next/cache";

import { db } from "@/db/client";
import { passwordProblem } from "@/lib/password";
import { requestLang } from "@/lib/access-emails";
import { platformPath, type PlatformLang } from "@/lib/platform-lang";
import { parseKey } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import { suggestSlug } from "@/lib/slug";

import { audit, passMembership, type Account } from "./auth";
import { startDreamRun } from "./dream-factory";
import { log } from "./log";
import { adminAuth } from "./supabase-admin";
import { approveAccessRequest, createAccessRequest, isSlugTaken, sendAccessEmail, type AccessRequestInput } from "./platform";
import { sameEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;

/**
 * Self-serve sign-up (wave 9 unit F, D359, `docs/wave-9-platform.md` section 3, F): while the platform's switch is on
 * (`platform_settings.self_serve_signup`, written only by `setSelfServe()`), `/sign-up` keeps the request as ever and emails a link to confirm
 * the address; the page the link opens has a button, and the press makes the account and the store through the approval's own path
 * (`approveAccessRequest()` with no admin, so `commerce.approve_access_request()`), then starts the store's trial. Nothing is made by opening
 * the link. At most `SIGNUPS_PER_ADDRESS_DAY` sign-ups an address a day and `SIGNUPS_PER_NETWORK_HOUR` a network an hour, counted under keyed
 * hashes in `commerce.chat_usage` (never the address or the network); the answer is the same whether a sign-up was counted, refused or merged.
 */

export const SIGNUPS_PER_ADDRESS_DAY = 3;
export const SIGNUPS_PER_NETWORK_HOUR = 20;
export const CONFIRM_HOURS = 24;
export const TRIAL_DAYS = 14;
/** Requests never confirmed are deleted this many days after their link ended. */
export const UNCONFIRMED_KEPT_DAYS = 7;

/** Whether self-serve sign-up is on. Off when the database cannot say. */
export async function selfServeOn(): Promise<boolean> {
  try {
    const [row] = await db().execute<Row>(sql`select coalesce((select self_serve_signup from commerce.platform_settings limit 1), false) as on`);
    return Boolean(row?.on);
  } catch (error) {
    log("error", "self_signup.setting_failed", {}, error);
    return false;
  }
}

/** The cache tag of the switch as the sign-up page reads it. */
export const SIGNUP_TAG = "self-signup";

/** The switch for the sign-up page's words, cached under `SIGNUP_TAG` (the page stays prerendered); `selfServeOn()` decides. */
export async function selfServeShown(): Promise<boolean> {
  "use cache";
  cacheLife("hours");
  cacheTag(SIGNUP_TAG);
  return selfServeOn();
}

/** Turns self-serve sign-up on or off (platform admins), audited. */
export async function setSelfServe(admin: Account, on: boolean): Promise<void> {
  await db().execute(sql`update commerce.platform_settings set self_serve_signup = ${on}`);
  await audit(admin.id, null, "platform.self_serve_signup_set", { on });
  updateTag(SIGNUP_TAG);
}

/** A counter's bucket: an HMAC with a key made from the settings key for this use alone, else (tests, a build) a plain hash. */
export function signupBucket(kind: "address" | "network", value: string, env: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY): string {
  const plain = value.trim().toLowerCase();
  const key = parseKey(env);
  const digest = key
    ? createHmac("sha256", createHmac("sha256", key).update("kaizen:self-signup").digest()).update(`${kind}|${plain}`).digest("hex")
    : createHash("sha256").update(`kaizen:self-signup|${kind}|${plain}`).digest("hex");
  return `signup:${kind[0]}:${digest.slice(0, 32)}`;
}

/** Counts one sign-up for the address and the network, and says whether both are still within their limits. A failure to count refuses. */
export async function takeSignupSlot(email: string, network: string | null): Promise<boolean> {
  try {
    const day = sql`date_trunc('day', now())`;
    const hour = sql`date_trunc('hour', now())`;
    const [address] = await db().execute<Row>(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${signupBucket("address", email)}, ${day}, 1)
      on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1 returning count
    `);
    let networkCount = 0;
    if (network) {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${signupBucket("network", network)}, ${hour}, 1)
        on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1 returning count
      `);
      networkCount = Number(row?.count ?? 0);
    }
    return Number(address?.count ?? 0) <= SIGNUPS_PER_ADDRESS_DAY && networkCount <= SIGNUPS_PER_NETWORK_HOUR;
  } catch (error) {
    log("error", "self_signup.count_failed", {}, error);
    return false;
  }
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const isToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

/** The page a confirmation link opens, in the request's language. */
export const confirmPath = (lang: PlatformLang, token: string) => platformPath(lang, `/sign-up/confirm/${token}`);

/**
 * A sign-up while the switch is on: within the limits, the request is kept (`createAccessRequest()`, merged with one pending for the
 * address) and marked self-serve with a new link, emailed to the address. Never says which happened.
 */
export async function startSelfSignup(
  input: AccessRequestInput,
  network: string | null,
  /** The Dream Factory's drill (D409) is handed the link's token, as the email would hand it to a person; nothing else is. */
  options: { onToken?: (token: string) => void } = {},
): Promise<void> {
  if (!(await takeSignupSlot(input.email, network))) {
    log("warn", "self_signup.limited", {});
    return;
  }
  await createAccessRequest(input, { quiet: true });
  const token = randomBytes(32).toString("base64url");
  const [row] = await db().execute<Row>(sql`
    update commerce.access_requests
       set self_serve = true, confirm_hash = ${hashOf(token)}, confirm_expires_at = now() + make_interval(hours => ${CONFIRM_HOURS})
     where lower(email) = lower(${input.email}) and status = 'pending'
    returning id, locale
  `);
  if (!row) return;
  options.onToken?.(token);
  await sendAccessEmail("confirm", String(row.id), `${siteUrl()}${confirmPath(requestLang(row.locale as string | null), token)}`);
  log("info", "self_signup.started", { requestId: String(row.id) });
}

/** What the confirmation page shows for a link: the store's name and the request's language, or null for a link that does not work. */
export async function confirmationOf(token: string): Promise<{ storeName: string; lang: PlatformLang } | null> {
  if (!isToken(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select store_name, locale from commerce.access_requests
    where confirm_hash = ${hashOf(token)} and status = 'pending' and self_serve and confirm_expires_at > now()
  `);
  return row ? { storeName: String(row.store_name), lang: requestLang(row.locale as string | null) } : null;
}

/** A free store address from the store's name: the name's own, else with a number, else with a random end. */
export async function freeSlug(storeName: string): Promise<string> {
  const base = suggestSlug(storeName) || "store";
  const stem = base.slice(0, 34).replace(/-+$/, "");
  if (base.length >= 3 && !(await isSlugTaken(base))) return base;
  for (let n = 2; n <= 9; n++) if (!(await isSlugTaken(`${stem}-${n}`))) return `${stem}-${n}`;
  return `${stem}-${randomBytes(3).toString("hex")}`;
}

export type ConfirmResult = { ok: true; storeName: string; password: boolean } | { ok: false; problem: "unknown" | "off" | "failed" | "password" };

/** Sets the new owner's password in Supabase Auth (an account confirmed by our own link); false when it could not be set. Injectable for tests. */
export type SetOwnerPassword = (email: string, password: string) => Promise<boolean>;

/** Through Supabase Auth's admin API: a new user with the address confirmed, or the existing one's password set. Never throws. */
export const setOwnerPasswordWithSupabase: SetOwnerPassword = async (email, password) => {
  const client = adminAuth();
  if (!client.ok) return false;
  try {
    const made = await client.admin.createUser({ email, password, email_confirm: true });
    if (!made.error) return true;
    // An address Supabase already knows (an earlier magic-link sign-in): its password is set instead, found among the users by address.
    for (let page = 1; page <= 20; page++) {
      const listed = await client.admin.listUsers({ page, perPage: 200 });
      if (listed.error) return false;
      const user = listed.data.users.find((u) => sameEmail(u.email ?? "", email));
      if (user) return !(await client.admin.updateUserById(user.id, { password })).error;
      if (listed.data.users.length < 200) return false;
    }
    return false;
  } catch (error) {
    log("error", "self_signup.password_failed", {}, error);
    return false;
  }
};

/**
 * The press on the confirmation page: the link is used once (claimed before anything is made), then, with the switch still on, the store
 * is made through the approval's own path and its trial started. Off, or when making the store fails, the request stays pending (confirmed)
 * for a platform admin, and the person is told.
 */
export async function confirmSelfSignup(
  token: string,
  options: { password?: string | null; setPassword?: SetOwnerPassword } = {},
): Promise<ConfirmResult> {
  if (!isToken(token)) return { ok: false, problem: "unknown" };
  // A password chosen at sign-up (wave 10 unit F, D369) is checked before the link is used, so a weak one can be put right on the same page.
  const password = (options.password ?? "").trim() === "" ? null : String(options.password);
  if (password) {
    const [request] = await db().execute<Row>(sql`
      select email from commerce.access_requests
      where confirm_hash = ${hashOf(token)} and status = 'pending' and self_serve and confirm_expires_at > now()
    `);
    if (!request) return { ok: false, problem: "unknown" };
    if (passwordProblem(password, String(request.email))) return { ok: false, problem: "password" };
  }
  const [claimed] = await db().execute<Row>(sql`
    update commerce.access_requests set confirmed_at = now(), confirm_hash = null
     where confirm_hash = ${hashOf(token)} and status = 'pending' and self_serve and confirm_expires_at > now()
    returning id, store_name, locale, message, dream
  `);
  if (!claimed) return { ok: false, problem: "unknown" };
  const requestId = String(claimed.id);
  const storeName = String(claimed.store_name);
  if (!(await selfServeOn())) return { ok: false, problem: "off" };
  try {
    const slug = await freeSlug(storeName);
    const made = await approveAccessRequest(null, requestId, slug, storeName, siteUrl());
    if (!made.ok) {
      log("error", "self_signup.store_failed", { requestId, problems: made.problems.length });
      return { ok: false, problem: "failed" };
    }
    await db().execute(sql`
      insert into commerce.store_billing (store_id, trial_ends_at) values (${made.storeId}::uuid, now() + make_interval(days => ${TRIAL_DAYS}))
      on conflict (store_id) do update set trial_ends_at = excluded.trial_ends_at
    `);
    const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${made.email})`);
    await audit(owner ? String(owner.id) : null, made.storeId, "store.self_signup", { requestId, trialDays: TRIAL_DAYS }, { area: "settings", target: { type: "store", id: made.storeId } });
    log("info", "self_signup.store_made", { requestId, storeId: made.storeId });
    // The password is set after the store is made: a failure leaves the owner the emailed link, and never undoes the store.
    const passwordSet = password ? await (options.setPassword ?? setOwnerPasswordWithSupabase)(made.email, password) : false;
    if (password && !passwordSet) log("warn", "self_signup.password_not_set", { requestId });
    // The Dream Factory (D409): the store is built from what they said they will sell. A run that cannot start never undoes the store.
    if (claimed.dream === true && owner) await startDreamFromSignup(slug, String(owner.id), String(claimed.message ?? ""), requestId);
    return { ok: true, storeName, password: passwordSet };
  } catch (error) {
    log("error", "self_signup.store_failed", { requestId }, error);
    return { ok: false, problem: "failed" };
  }
}

/** Starts the store's Dream Factory run in its new owner's name; logged, never thrown. */
async function startDreamFromSignup(slug: string, ownerId: string, prompt: string, requestId: string): Promise<void> {
  try {
    const member = await passMembership(slug, ownerId);
    const started = member ? await startDreamRun(member, prompt) : { ok: false as const, problem: "no owner" };
    if (!started.ok) log("warn", "self_signup.dream_not_started", { requestId });
  } catch (error) {
    log("error", "self_signup.dream_failed", { requestId }, error);
  }
}

/** Self-serve requests never confirmed, deleted `UNCONFIRMED_KEPT_DAYS` after their link ended (the daily retention). */
export async function pruneUnconfirmedSignups(): Promise<number> {
  const gone = await db().execute<Row>(sql`
    delete from commerce.access_requests
     where status = 'pending' and self_serve and confirmed_at is null
       and confirm_expires_at < now() - make_interval(days => ${UNCONFIRMED_KEPT_DAYS})
    returning id
  `);
  return gone.length;
}

/** Self-serve requests waiting for their address to be confirmed, for the platform's requests page. */
export async function unconfirmedCount(): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.access_requests where status = 'pending' and self_serve and confirmed_at is null
  `);
  return Number(row?.n ?? 0);
}

/** A store's trial end (D359), or null. */
export async function trialEndOf(storeId: string): Promise<Date | null> {
  const [row] = await db().execute<Row>(sql`select trial_ends_at from commerce.store_billing where store_id = ${storeId}::uuid`);
  return row?.trial_ends_at ? new Date(String(row.trial_ends_at)) : null;
}

