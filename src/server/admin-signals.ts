import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { ADMIN_USE_NOTICE, ADMIN_USE_REVIEW, unansweredQuestions, type AdminSignalChoice } from "@/lib/admin-signals";

import { audit } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Heatmaps and recordings of how store owners use the admin (D895 phase 3b, `docs/dpia-admin-use.md`): the lock, who is asked, and each
 * person's own choice. The only writer of `platform_settings.admin_signals_open` and `platform_admin_signal_choices`.
 *
 * - The switch opens only once a Legal account has answered every question of the review `admin-use` and the platform owner confirms the
 *   assessment is signed (`openAdminSignals()`); it closes at any time.
 * - Only a store **owner** is asked, about their own use: never a staff member (the lawyer's question 3, the owner's answer of 26 November
 *   2026), never a platform admin. Nothing is collected from anyone who has not said yes, and the collectors check the stored choice again.
 * - Every choice is a row, never edited: the newest stands, and the earlier ones are the record of consent and its withdrawal.
 */

export type AdminSignalsState = { open: boolean; openedAt: string | null; missing: string[] };

/** Whether the switch is open, and which questions still wait for a Legal account's answer. */
export async function adminSignalsState(): Promise<AdminSignalsState> {
  const [setting, answered] = await Promise.all([
    typedRow(
      z.object({ open: col.bool, opened_at: col.timestampOrNull }),
      sql`select admin_signals_open as open, admin_signals_opened_at as opened_at from commerce.platform_settings limit 1`,
    ),
    typedRows(
      z.object({ item: col.text }),
      sql`select distinct v.item from commerce.platform_legal_views v join commerce.accounts a on a.id = v.account_id
           where v.review = ${ADMIN_USE_REVIEW} and a.platform_role = 'legal'`,
    ),
  ]);
  return { open: setting?.open ?? false, openedAt: setting?.opened_at ?? null, missing: unansweredQuestions(answered.map((r) => r.item)) };
}

/**
 * Opens the switch for a platform owner (the caller checks the role), only when every question is answered by a Legal account and the
 * owner confirms the assessment is signed. Written to the change log.
 */
export async function openAdminSignals(accountId: string, signed: boolean): Promise<{ ok: true } | { ok: false; problem: "locked" | "signed" }> {
  const state = await adminSignalsState();
  if (state.missing.length > 0) return { ok: false, problem: "locked" };
  if (!signed) return { ok: false, problem: "signed" };
  await typedRow(
    z.object({ ok: col.bool }),
    sql`update commerce.platform_settings set admin_signals_open = true, admin_signals_opened_at = now(), admin_signals_opened_by = ${accountId}::uuid
        returning true as ok`,
  );
  await audit(accountId, null, "platform.admin_signals_opened", { notice: ADMIN_USE_NOTICE });
  return { ok: true };
}

/** Closes the switch: nothing more is collected (the collectors and the routes read it). Written to the change log. */
export async function closeAdminSignals(accountId: string): Promise<void> {
  await typedRow(z.object({ ok: col.bool }), sql`update commerce.platform_settings set admin_signals_open = false returning true as ok`);
  await audit(accountId, null, "platform.admin_signals_closed", {});
}

/**
 * Whether this person may be asked, and what they chose: the switch open, the person a store's owner and not a platform admin. `choice` is
 * null until they answer under the current notice (a new notice asks again, and nothing is collected meanwhile).
 */
export async function adminSignalsFor(accountId: string): Promise<{ eligible: boolean; choice: AdminSignalChoice | null }> {
  const row = await typedRow(
    z.object({ eligible: col.bool, heatmaps: col.bool.nullable(), recordings: col.bool.nullable() }),
    sql`
      select (select admin_signals_open from commerce.platform_settings limit 1)
             and not a.platform_admin
             and exists (select 1 from commerce.store_members m where m.account_id = a.id and m.role = 'owner') as eligible,
             c.heatmaps, c.recordings
      from commerce.accounts a
      left join lateral (
        select heatmaps, recordings from commerce.platform_admin_signal_choices where account_id = a.id and notice = ${ADMIN_USE_NOTICE} order by chosen_at desc, id desc limit 1
      ) c on true
      where a.id = ${accountId}::uuid and a.disabled_at is null
    `,
  );
  if (!row) return { eligible: false, choice: null };
  return { eligible: row.eligible, choice: row.heatmaps === null ? null : { heatmaps: row.heatmaps, recordings: row.recordings ?? false } };
}

/** Keeps a person's own choice (only while they may be asked), as a new row under the current notice. Written to the change log. */
export async function chooseAdminSignals(accountId: string, choice: AdminSignalChoice): Promise<boolean> {
  const { eligible } = await adminSignalsFor(accountId);
  if (!eligible) return false;
  await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.platform_admin_signal_choices (account_id, heatmaps, recordings, notice)
        values (${accountId}::uuid, ${choice.heatmaps}, ${choice.recordings && choice.heatmaps}, ${ADMIN_USE_NOTICE}) returning id`,
  );
  await audit(accountId, null, "account.admin_signals_chosen", { heatmaps: choice.heatmaps, recordings: choice.recordings, notice: ADMIN_USE_NOTICE }, { area: "account" });
  return true;
}
