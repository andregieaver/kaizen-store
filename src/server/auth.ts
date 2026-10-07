import "server-only";

import { sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { db } from "@/db/client";
import { areaOfAction, type AuditChanges } from "@/lib/audit";
import { isColorChoice, type ColorChoice } from "@/lib/color-mode";
import { signedInWithin } from "@/lib/fresh-sign-in";
import { type PermissionHolder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { assuranceOf, heldPath, KILL_SWITCH_ACTION, mayUseAdmin, twoStepKillSwitch, TWO_STEP_PATHS, type Assurance } from "@/lib/two-step";

import { getStore, type Store } from "./stores";

export type Role = "owner" | "admin";

/** What the second step stands at for a session (docs/wave-1-trust.md 2.8): the signed `aal` claim, and whether the account has a verified factor. */
export type AccountAssurance = { level: "aal1" | "aal2"; enrolled: boolean };

/** A person who can sign in (docs/platform.md, P5). */
export type Account = {
  id: string;
  email: string;
  name: string | null;
  platformAdmin: boolean;
  /** Their own profile picture in the avatars bucket (D97), if they chose one. */
  avatarPath?: string | null;
  /** The admin's colours for them (D99): their device's, light or dark. */
  colorMode?: ColorChoice;
  /** Where the session stands on two-step sign-in (wave 1, 1f): set by `getAccount()` and `getSessionAccount()`, absent on a hand-made account in a test. */
  assurance?: AccountAssurance;
};

/**
 * An account's access to one store. `kind`, `expiresAt` and the role fields are read from the member's row and their custom role (wave 1, 1f);
 * `permissions` is the custom role's keys, null for the default admin set. Ask what a member may do with `memberCan()` (`src/server/permissions.ts`),
 * never by comparing `role` with `"owner"`.
 */
export type Membership = {
  account: Account;
  store: Store;
  role: Role;
  /** `collaborator`: an agency's account invited with an expiry. */
  kind?: "staff" | "collaborator";
  expiresAt?: Date | null;
  roleId?: string | null;
  roleName?: string | null;
  permissions?: readonly string[] | null;
};

/** The part of a membership the permission rules read. */
export const holderOf = (member: Pick<Membership, "role" | "kind" | "permissions">): PermissionHolder => ({
  role: member.role,
  kind: member.kind,
  permissions: member.permissions,
});

export type StoreSummary = { slug: string; name: string; role: Role; /** The store has Work switched on (D122). */ workOn: boolean };

// ---------------------------------------------------------------------------
// The session and its second step (wave 1, 1f, docs/wave-1-trust.md 2.8)
// ---------------------------------------------------------------------------

/**
 * What a verified session is, read once per request. The two facts the second step rests on come from trusted places only:
 * the `aal` claim of the verified token (`getClaims()`), and for a session at `aal1` one server-side `getUser()` whose `factors`
 * list is the Auth server's own. The session cookie's copy of the user is the person's to edit and is never read for this.
 */
export type SessionFacts = {
  account: Account;
  level: "aal1" | "aal2";
  /** Whether the account has a verified factor; null when Supabase Auth could not be asked (an `aal1` session only). */
  enrolled: boolean | null;
  reenrolPending: boolean;
  authUserId: string;
  killSwitch: boolean;
};

type Row = Record<string, unknown>;

const toAccount = (row: Row): Account => ({
  id: String(row.id),
  email: String(row.email),
  name: row.name ? String(row.name) : null,
  platformAdmin: Boolean(row.platform_admin),
  avatarPath: row.avatar_path ? String(row.avatar_path) : null,
  colorMode: isColorChoice(row.color_mode) ? row.color_mode : "system",
});

/** The kill switch (`ADMIN_TWO_STEP=off`) is read per call, so a test or a redeploy changes it at once. */
const killSwitchOn = (): boolean => twoStepKillSwitch(process.env.ADMIN_TWO_STEP);

/**
 * The session's account with what the gate needs, or null when nobody is signed in (no valid session, or no active account).
 * Whether the person may use the admin is `assuranceOf()`'s to say; this only reports the facts.
 */
export const readSession = cache(async (): Promise<SessionFacts | null> => {
  // Who is signed in is known only per request: never decided while
  // prerendering, even where Supabase is not configured and nothing below
  // would read the request (else a page's shell is built with no account).
  await connection();
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return null; // Supabase is not configured (e.g. in CI).
  }
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return null;
  const level = (data?.claims as { aal?: unknown } | undefined)?.aal === "aal2" ? "aal2" : "aal1";

  const [row] = await db().execute<Row>(sql`
    select id, email, name, platform_admin, avatar_path, color_mode, two_step_since, two_step_reenrol_at from commerce.accounts
    where auth_user_id = ${userId}::uuid and disabled_at is null
  `);
  if (!row) return null;

  const killSwitch = killSwitchOn();
  let enrolled: boolean | null = true;
  if (level === "aal1" && !killSwitch) {
    // The server's own list of factors, one call per request (React's cache). An `aal2` session proves it and costs no call.
    try {
      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.user) enrolled = null;
      else enrolled = (user.user.factors ?? []).some((factor) => factor.status === "verified");
    } catch {
      enrolled = null;
    }
  }
  const account: Account = { ...toAccount(row), assurance: { level, enrolled: enrolled === true } };

  // The display mirror (Team page, platform's customer page): never read for access.
  try {
    if (level === "aal2" && !row.two_step_since) {
      await db().execute(sql`update commerce.accounts set two_step_since = now() where id = ${account.id}::uuid and two_step_since is null`);
    } else if (level === "aal1" && enrolled === false && row.two_step_since) {
      await db().execute(sql`update commerce.accounts set two_step_since = null where id = ${account.id}::uuid and two_step_since is not null`);
    }
    // The break-glass is audit-logged, at most once in 12 hours for an account that has signed in while it is on.
    if (killSwitch) {
      await db().execute(sql`
        insert into commerce.audit_log (account_id, store_id, action, details, area)
        select ${account.id}::uuid, null, ${KILL_SWITCH_ACTION}, '{}'::jsonb, 'account'
        where not exists (
          select 1 from commerce.audit_log a
          where a.account_id = ${account.id}::uuid and a.action = ${KILL_SWITCH_ACTION} and a.created_at > now() - interval '12 hours'
        )
      `);
    }
  } catch {
    // The mirror and the note are not worth stopping a page for.
  }

  return { account, level, enrolled, reenrolPending: Boolean(row.two_step_reenrol_at), authUserId: userId, killSwitch };
});

/** What the second step asks of a session, for the account alone (a store's own requirement is added where the store is known). */
export function assuranceFor(session: SessionFacts, storeRequires = false): Assurance {
  return assuranceOf({
    level: session.level,
    enrolled: session.enrolled,
    platformAdmin: session.account.platformAdmin,
    storeRequires,
    reenrolPending: session.reenrolPending,
    killSwitch: session.killSwitch,
  });
}

/**
 * The signed-in person and where they stand on two-step sign-in, whether or not they may use the admin yet: for the gate and
 * the sign-in and two-step pages only. Everything else asks `getAccount()`, which fails closed.
 */
export async function getAssurance(): Promise<{ account: Account; assurance: Assurance; session: SessionFacts } | null> {
  const session = await readSession();
  return session ? { account: session.account, assurance: assuranceFor(session), session } : null;
}

/** The signed-in account whatever its second step stands at, or null: for the sign-in and two-step pages only (docs/wave-1-trust.md 2.8). */
export async function getSessionAccount(): Promise<Account | null> {
  return (await readSession())?.account ?? null;
}

/**
 * The signed-in account, or null. The Supabase session token is verified (not just read from the cookie) and must belong to an
 * active account. **Fail closed** (wave 1, 1f): an account with a verified factor whose session has not passed it, a platform
 * admin without a second step, a person whose second step was reset and one whose enrolment could not be read are not let in: it is
 * null for them, so every caller (the platform's routes, the consent page, hosts, the assistant's routes) is safe with no edit.
 */
export const getAccount = cache(async (): Promise<Account | null> => {
  const session = await readSession();
  if (!session) return null;
  return mayUseAdmin(assuranceFor(session)) ? session.account : null;
});

/** Where a held person goes to finish their second step, with `next` for after; the error page when it could not be read. */
export function heldDestination(assurance: Assurance, next?: string | null): string | null {
  if (assurance.state === "unknown") return `${TWO_STEP_PATHS.challenge}?unavailable=1`;
  return heldPath(assurance, next);
}

/** For pages and actions: the account, or a redirect to sign in (or, for someone held at their second step, to it). */
export async function requireAccount(): Promise<Account> {
  const account = await getAccount();
  if (account) return account;
  const held = await getAssurance();
  const destination = held ? heldDestination(held.assurance) : null;
  redirect(destination ?? "/admin/sign-in");
}

/**
 * For platform pages and actions: a platform admin's account; anyone else
 * signs in or is not found. Every platform page asks for itself: a
 * layout's check does not stop its page rendering (and streaming its data)
 * alongside it.
 */
export async function requirePlatformAdmin(): Promise<Account> {
  const account = await requireAccount();
  if (!account.platformAdmin) notFound();
  return account;
}

/** The stores an account works in, by name. */
export async function listStores(account: Account): Promise<StoreSummary[]> {
  const rows = await db().execute<Row>(sql`
    select s.slug, s.name, m.role, 'work' = any(s.modules) as work_on
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${account.id}::uuid and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now())
      -- Store templates (D175) are the platform's work, reached from its Store templates page.
      and s.status <> 'closed' and not s.starter
    order by lower(s.name), s.slug
  `);
  return rows.map((row) => ({
    slug: String(row.slug),
    name: String(row.name),
    role: row.role as Role,
    workOn: Boolean(row.work_on),
  }));
}

/** Whether the signed-in person proved who they are in the last ten minutes (D171): asked before closing a store. The claim is the verified token's own. */
export async function signedInRecently(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return signedInWithin((data?.claims as { amr?: unknown } | undefined)?.amr, Math.floor(Date.now() / 1000));
  } catch {
    return false;
  }
}

/** The account's stores that are closed (D171): kept out of the level switcher, listed on the stores page so an owner can open one to read its orders or reopen it. */
export async function listClosedStores(account: Account): Promise<{ slug: string; name: string; role: Role; closedAt: Date | null }[]> {
  const rows = await db().execute<Row>(sql`
    select s.slug, s.name, m.role, s.closed_at
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${account.id}::uuid and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now())
      and s.status = 'closed' and not (s.is_template or s.starter)
    order by s.closed_at desc nulls last, s.slug
  `);
  return rows.map((row) => ({
    slug: String(row.slug),
    name: String(row.name),
    role: row.role as Role,
    closedAt: row.closed_at ? new Date(String(row.closed_at)) : null,
  }));
}

/** A store's member, held at their second step, or nobody: what `loadMembership()` found. */
type MembershipState = { state: "none" } | { state: "held"; assurance: Assurance } | { state: "ok"; membership: Membership };

const loadMembership = cache(async (storeSlug: string): Promise<MembershipState> => {
  const session = await readSession();
  if (!session) return { state: "none" };
  const store = await getStore(storeSlug);
  // A closed store stays open to its members, who may read and handle what already happened or reopen it (D171): `memberCan()` keeps
  // everything that sells or changes the shop out of their reach.
  if (!store) return { state: "none" };

  // The store's requirement for two-step is read here, never from the cached store: a security decision is not stale for an hour.
  // A collaborator whose access has ended is not a member (`expires_at`), whether or not the daily job has marked it yet.
  const [row] = await db().execute<Row>(sql`
    select m.role, m.kind, m.expires_at, m.role_id, r.name as role_name, r.permissions, s.require_two_step
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
    where m.store_id = ${store.id}::uuid and m.account_id = ${session.account.id}::uuid
      and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      -- A starter store is worked in only while it is a store template's working store (D177): a template's frozen copy, a design
      -- profile's workspace and the store of a deleted template are the platform's, edited from its own pages or not at all.
      and (not s.starter or exists (select 1 from commerce.store_starters st where st.store_id = s.id))
  `);
  if (!row) return { state: "none" };

  const assurance = assuranceFor(session, Boolean(row.require_two_step));
  if (!mayUseAdmin(assurance)) return { state: "held", assurance };
  return {
    state: "ok",
    membership: {
      account: session.account,
      store,
      role: row.role as Role,
      kind: row.kind === "collaborator" ? "collaborator" : "staff",
      expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
      roleId: row.role_id ? String(row.role_id) : null,
      roleName: row.role_name ? String(row.role_name) : null,
      permissions: row.role_id ? ((row.permissions ?? []) as string[]).map(String) : null,
    },
  };
});

/**
 * The signed-in account's membership of a store, or null: also null for a member held at their second step by the store's
 * requirement (a route handler answers 401 or 404; a page asks `requireMember()`, which sends them to set one up) and for a
 * collaborator whose access has ended.
 */
export const getMembership = cache(async (storeSlug: string): Promise<Membership | null> => {
  const found = await loadMembership(storeSlug);
  return found.state === "ok" ? found.membership : null;
});

/**
 * For store admin pages and actions: the membership, a redirect to sign in (or to the second step), or a 404 for a store the
 * account does not work in (so store names cannot be probed). Pages and actions ask `requirePermission()` instead
 * (`src/server/permissions.ts`), which is this plus what the member may do.
 */
export async function requireMember(storeSlug: string): Promise<Membership> {
  await requireAccount();
  const found = await loadMembership(storeSlug);
  if (found.state === "held") redirect(heldDestination(found.assurance) ?? "/admin/sign-in");
  if (found.state !== "ok") notFound();
  return found.membership;
}

/**
 * Whether a sign-in link may be sent to this email: an active account that
 * works in at least one store, hosts for one (D71), or runs the platform.
 */
export async function canSignIn(email: string): Promise<boolean> {
  return (await signInAccount(email)) !== null;
}

/**
 * The same check as canSignIn, also saying whether the account has signed in
 * before (and so has a Supabase Auth user that a password can be reset for).
 */
export async function signInAccount(email: string): Promise<{ linked: boolean } | null> {
  const [row] = await db().execute<Row>(sql`
    select a.auth_user_id is not null as linked from commerce.accounts a
    where lower(a.email) = lower(${email}) and a.disabled_at is null
      and (a.platform_admin or exists (
        select 1 from commerce.store_members m
        where m.account_id = a.id and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      ) or exists (
        -- Outside hosts (D71) sign in to their own area.
        select 1 from commerce.hosts h
        where h.account_id = a.id and h.disabled_at is null
      ))
  `);
  return row ? { linked: Boolean(row.linked) } : null;
}

/**
 * Links a Supabase Auth user to the account with the same email, on first
 * sign-in. Returns null if the email has no active account.
 */
export async function linkAccount(authUserId: string, email: string): Promise<Account | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.accounts
       set auth_user_id = ${authUserId}::uuid
     where lower(email) = lower(${email})
       and disabled_at is null
       and (auth_user_id is null or auth_user_id = ${authUserId}::uuid)
    returning id, email, name, platform_admin, avatar_path, color_mode
  `);
  return row ? toAccount(row) : null;
}

/** Keeps the account's light or dark for the admin (D99), so it follows them to any device. */
export async function saveColorMode(accountId: string, choice: ColorChoice): Promise<void> {
  await db().execute(sql`update commerce.accounts set color_mode = ${choice} where id = ${accountId}::uuid`);
}

/** What an entry can say beyond its action and details (wave 1, 1f, docs/wave-1-trust.md 2.10): where it belongs, what it was done to, what changed. */
export type AuditExtra = {
  /** The part of the admin it belongs to; the action's prefix decides when left out (`areaOfAction()`). */
  area?: string;
  target?: { type: string; id: string };
  /** `{ field: { from, to } }` from `diffOf()`: only allowlisted fields, never a secret. */
  changes?: AuditChanges;
};

/** Records a staff, settings or platform change. Never pass secrets in `details`. */
export async function audit(
  accountId: string | null,
  storeId: string | null,
  action: string,
  details: Record<string, unknown> = {},
  extra: AuditExtra = {},
): Promise<void> {
  const area = extra.area ?? areaOfAction(action);
  await db().execute(sql`
    insert into commerce.audit_log (account_id, store_id, action, details, area, target_type, target_id, changes)
    values (${accountId}::uuid, ${storeId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb, ${area},
      ${extra.target?.type ?? null}, ${extra.target?.id ?? null},
      ${extra.changes ? JSON.stringify(extra.changes) : null}::jsonb)
  `);
}
