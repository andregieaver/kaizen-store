import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { applyGuideEvent, guideProgressOf, guideSettingsOf, type GuideEvent, type GuideProgress, type GuideSettings } from "@/lib/guide";

import { owned } from "./owned";
import { col, typedRow } from "./typed-rows";

/**
 * Guide's record (D909, `src/lib/guide.ts`): one row of `commerce.guide_progress` per person and level (a store, the platform's null, or
 * the owner's control center, `level` `owner`),
 * written only here, and the person's own choice on their account (`guide_level`, `guide_off`). Read once when an admin screen's Guide
 * starts in the browser, never by the layout, so no screen waits on it.
 */
/** Whose record and where: a store's admin (`storeId`), the platform's (no store) or the owner's control center (no store, `owner`). */
export type GuideScope = { accountId: string; storeId: string | null; owner?: boolean };

/** The row's level: none for a store's or the platform's, `owner` for the control center. */
const levelOf = (scope: GuideScope, column = sql`level`) => (scope.owner ? sql`${column} = 'owner'` : sql`${column} is null`);

const READ = z.object({ guide_level: col.textOrNull, guide_off: z.array(z.string()), state: z.unknown() });
const STATE = z.object({ state: z.unknown() });

/** The person's record at this level and their choice; a level never visited reads as a fresh record started now. */
export async function readGuide(scope: GuideScope): Promise<{ progress: GuideProgress; settings: GuideSettings }> {
  const row = await typedRow(
    READ,
    sql`select a.guide_level, a.guide_off, g.state
        from commerce.accounts a
        left join commerce.guide_progress g on g.account_id = a.id and ${owned(scope.storeId, sql`g.store_id`)} and ${levelOf(scope, sql`g.level`)}
        where a.id = ${scope.accountId}::uuid`,
  );
  const now = new Date().toISOString();
  return { progress: guideProgressOf(row?.state ?? null, now), settings: guideSettingsOf(row?.guide_level ?? null, row?.guide_off ?? []) };
}

/** Applies one event to the person's record at this level, made on the first, and gives back the record as kept. */
export async function recordGuide(scope: GuideScope, event: GuideEvent): Promise<GuideProgress> {
  return db().transaction(async (tx) => {
    const now = new Date().toISOString();
    await tx.execute(
      sql`insert into commerce.guide_progress (account_id, store_id, level, state)
          values (${scope.accountId}::uuid, ${scope.storeId}::uuid, ${scope.owner ? "owner" : null}, ${JSON.stringify({ startedAt: now })}::jsonb)
          on conflict on constraint guide_progress_key do nothing`,
    );
    const row = await typedRow(
      STATE,
      sql`select state from commerce.guide_progress where account_id = ${scope.accountId}::uuid and ${owned(scope.storeId)} and ${levelOf(scope)} for update`,
      tx,
    );
    const next = applyGuideEvent(guideProgressOf(row?.state ?? null, now), event, now);
    await tx.execute(
      sql`update commerce.guide_progress set state = ${JSON.stringify(next)}::jsonb, updated_at = now()
          where account_id = ${scope.accountId}::uuid and ${owned(scope.storeId)} and ${levelOf(scope)}`,
    );
    return next;
  });
}

/** Keeps the person's choice: a level (null for automatic) and the kinds switched off. */
export async function saveGuideSettings(accountId: string, settings: GuideSettings): Promise<void> {
  const off = `{${settings.off.join(",")}}`;
  await db().execute(sql`update commerce.accounts set guide_level = ${settings.level}, guide_off = ${off}::text[] where id = ${accountId}::uuid`);
}
