import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { GRACE_DAYS } from "@/lib/account-billing";
import { EXTENSION_IDS, isExtensionId, LAUNCH_TRIAL_DAYS, type ExtensionId } from "@/lib/extensions";

import { movePreviews, moveAccount } from "./account-move";
import { audit, type Account } from "./auth";
import { forgetLimits } from "./limits";
import { experimentsTag } from "@/lib/cache-tags";
import { refreshTag } from "./refresh";
import type { SaveResult } from "./settings";
import { storeTag } from "./stores";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The launch of paid extensions (D748 step E5 part two, `docs/extensions.md` 13): one press on Platform → Plans → Extensions moves every
 * account still billed store by store to one plan (`moveAccount()`), gives every other account its row (an account made later gets one as it
 * is made: `organisation_billed_after_launch`), gives each account a 60-day trial of every extension it already uses and its plan does not
 * include, and sets `platform_settings.extensions_launched_at`. From then on an account has only what its plan includes, what it pays for
 * and its trials, and no account is billed store by store. Nothing here runs on its own.
 */

/** A store whose records count as an account's use: open, and never a template, demo store, sandbox or Kaizena Flow's own. */
const COUNTED_STORE = sql`s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)`;

/**
 * The extensions each account uses (evidence per extension: its records exist in one of the account's open stores), Kaizena Flow's own
 * account never. Pages that make a first record on a visit (a deal pipeline, a contract template) are left out: a visit is not use.
 */
const USED = sql`
  select distinct s.organisation_id, x.extension_id
    from commerce.stores s
    join commerce.organisations o on o.id = s.organisation_id and not o.platform
    cross join lateral (
      select 'ab_testing'::text as extension_id where exists (select 1 from commerce.experiments e where e.store_id = s.id)
      union all
      select 'support_desk' where exists (select 1 from commerce.support_settings d where d.store_id = s.id and d.mode <> 'off')
      union all
      select 'email_automation'
       where exists (select 1 from commerce.broadcasts b where b.store_id = s.id)
          or exists (select 1 from commerce.automations a where a.store_id = s.id)
          or exists (select 1 from commerce.flows f where f.store_id = s.id)
      union all
      select 'work'
       where exists (select 1 from commerce.work_clients c where c.store_id = s.id)
          or exists (select 1 from commerce.work_invoices i where i.store_id = s.id)
          or exists (select 1 from commerce.work_time_entries t where t.store_id = s.id)
          or exists (select 1 from commerce.ledger_books l where l.store_id = s.id)
      union all
      select 'deals'
       where exists (select 1 from commerce.deals d where d.store_id = s.id)
          or exists (select 1 from commerce.contracts c where c.store_id = s.id)
      union all
      select 'projects' where exists (select 1 from commerce.checklists l where l.store_id = s.id)
    ) x
   where ${COUNTED_STORE}
`;

/**
 * The trials the launch gives: each used extension the account's plan does not include (`organisation_extension_facts()`, the gates' own
 * reading: before an account moves, its stores' running plans; after, its account's plan) and the account has no row for.
 */
const LAUNCH_TRIALS = sql`
  select u.organisation_id, u.extension_id from (${USED}) u
   where not (commerce.organisation_extension_facts(u.organisation_id) -> 'included') @> jsonb_build_array(u.extension_id)
     and not exists (select 1 from commerce.organisation_extensions e where e.organisation_id = u.organisation_id and e.extension_id = u.extension_id)
`;

const TRIAL_ROW = z.object({ organisation_id: col.uuid, extension_id: z.string().refine(isExtensionId) });

/** What the launch would do now, or did: shown above its button. */
export type LaunchPreview = {
  launchedAt: string | null;
  /** Accounts still billed store by store, which move to one plan each. */
  moving: number;
  /** Store subscriptions that end with credit for the unused time when their accounts move. */
  ending: number;
  /** Accounts that get a trial of each extension, in the catalogue's order. */
  trials: { extensionId: ExtensionId; accounts: number }[];
  /** When the launch's trials end if it is pressed at `now`. */
  trialsEnd: string;
};

/** The launch's preview at `now`: the accounts that move, the plans that end, and the trials per extension. */
export async function launchPreview(now = new Date()): Promise<LaunchPreview> {
  const [settings, previews, trials] = await Promise.all([
    typedRow(z.object({ at: col.timestampOrNull }), sql`select extensions_launched_at as at from commerce.platform_settings`),
    movePreviews(),
    typedRows(TRIAL_ROW, LAUNCH_TRIALS),
  ]);
  const moving = previews.filter((p) => !p.billed);
  return {
    launchedAt: settings?.at ?? null,
    moving: moving.length,
    ending: moving.reduce((n, p) => n + p.ending.length, 0),
    trials: EXTENSION_IDS.map((extensionId) => ({ extensionId, accounts: trials.filter((t) => t.extension_id === extensionId).length })),
    trialsEnd: new Date(now.getTime() + LAUNCH_TRIAL_DAYS * 86_400_000).toISOString(),
  };
}

/** Why the launch did not happen: it already has, or an account's move was refused (the launch can be pressed again to go on). */
export type LaunchResult = SaveResult & { trials?: number; moved?: number };

/**
 * Launches extensions. Each account still billed store by store is moved first, one by one (a move refused stops the launch before
 * anything is sold, and pressing again goes on from there); then, in one transaction that holds the platform's settings row, the 60-day
 * trials are written and `extensions_launched_at` is set, so two presses never launch twice. Every store's cached read carries the launch
 * in its facts, so every store is refreshed after.
 */
export async function launchExtensions(actor: Account, now = new Date()): Promise<LaunchResult> {
  const before = await typedRow(z.object({ at: col.timestampOrNull }), sql`select extensions_launched_at as at from commerce.platform_settings`);
  if (before?.at) return { ok: false, problems: ["Extensions are on sale already."] };

  const notes: string[] = [];
  const refused: string[] = [];
  let moved = 0;
  for (const preview of await movePreviews()) {
    if (preview.billed) continue;
    const result = await moveAccount(actor, preview.organisationId);
    if (!result.ok) refused.push(`${preview.name}: ${result.problems.join(" ")}`);
    else {
      moved += 1;
      if (result.note) notes.push(`${preview.name}: ${result.note}`);
    }
  }
  if (refused.length > 0) return { ok: false, problems: refused, moved };

  const trialEnds = new Date(now.getTime() + LAUNCH_TRIAL_DAYS * 86_400_000);
  const graceEnds = new Date(trialEnds.getTime() + GRACE_DAYS * 86_400_000);
  const trials = await db().transaction(async (tx) => {
    const held = await typedRow(z.object({ at: col.timestampOrNull }), sql`select extensions_launched_at as at from commerce.platform_settings for update`, tx);
    if (held?.at) return null;
    // An account with an open store made while the moves ran is moved by the next press, never left behind.
    const behind = await typedRow(
      z.object({ n: col.int }),
      sql`
        select count(*)::int as n from commerce.organisations o
         where not o.platform and not exists (select 1 from commerce.organisation_billing ob where ob.organisation_id = o.id)
           and exists (select 1 from commerce.stores s where s.organisation_id = o.id and ${COUNTED_STORE})
      `,
      tx,
    );
    if ((behind?.n ?? 0) > 0) return "behind" as const;
    // Every other account (none of its stores open) is billed through its account too, keeping its stores' latest trial.
    await tx.execute(sql`
      insert into commerce.organisation_billing (organisation_id, trial_ends_at, updated_by)
      select o.id,
             (select max(b.trial_ends_at) from commerce.stores s join commerce.store_billing b on b.store_id = s.id where s.organisation_id = o.id),
             ${actor.id}::uuid
        from commerce.organisations o where not o.platform
      on conflict (organisation_id) do nothing
    `);
    const written = await writeLaunchTrials(tx, trialEnds, graceEnds);
    await tx.execute(sql`update commerce.platform_settings set extensions_launched_at = ${now.toISOString()}::timestamptz, updated_by = ${actor.id}::uuid`);
    return written;
  });
  if (trials === null) return { ok: false, problems: ["Extensions are on sale already."], moved };
  if (trials === "behind") return { ok: false, problems: ["An account was made while the others moved: press Launch again to move it too."], moved };

  await refreshEveryStore();
  forgetLimits();
  const perExtension = Object.fromEntries(EXTENSION_IDS.map((id) => [id, trials.filter((t) => t.extension_id === id).length]));
  await audit(actor.id, null, "platform.extensions_launched", { moved, trials: trials.length, perExtension, trialDays: LAUNCH_TRIAL_DAYS });
  return notes.length > 0 ? { ok: true, note: notes.join(" "), trials: trials.length, moved } : { ok: true, trials: trials.length, moved };
}

/** Writes the launch's trials, each at its extension's smallest offered size, with its grace period set with it. */
async function writeLaunchTrials(tx: Executor, trialEnds: Date, graceEnds: Date) {
  return typedRows(
    TRIAL_ROW,
    sql`
      insert into commerce.organisation_extensions (organisation_id, extension_id, source, size_id, trial_ends_at, grace_ends_at)
      select t.organisation_id, t.extension_id, 'trial',
             (select es.id from commerce.extension_sizes es where es.extension_id = t.extension_id and es.active order by es.position, es.created_at limit 1),
             ${trialEnds.toISOString()}::timestamptz, ${graceEnds.toISOString()}::timestamptz
        from (${LAUNCH_TRIALS}) t
      on conflict (organisation_id, extension_id) do nothing
      returning organisation_id, extension_id
    `,
    tx,
  );
}

/** Every store's cached read and A/B tests' tag: the launch is in every store's extension facts. */
async function refreshEveryStore(): Promise<void> {
  const rows = await typedRows(z.object({ id: col.uuid, slug: col.text }), sql`select id, slug from commerce.stores`);
  for (const row of rows) {
    refreshTag(storeTag(row.slug));
    refreshTag(experimentsTag(row.id));
  }
}
