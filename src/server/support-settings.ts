import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { SupportMode } from "@/lib/support-rules";
import { deskSettingsInput } from "@/lib/support-settings-schema";

import { aiFor } from "./ai";
import { audit } from "./auth";
import { getChatAgentForEdit } from "./chat-agent";
import { ensureDesk, type DeskSettings } from "./support";
import type { StaffDesk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * A desk's settings (D216, `docs/support.md` 2.10, step 5): who answers its customers, email follow-up, opening hours, when quiet
 * conversations end, when people are emailed about a waiting customer, how people are named, the customer's tone (step 6) and (the
 * owner's alone) how long transcripts are kept. Saved by people who may answer the desk (`support:write`, or a platform admin for Kaizen's).
 */

export type DeskSettingsView = DeskSettings & {
  /** Whether the AI could answer first: the site has a saved chat assistant and a text model. */
  aiReady: boolean;
};

export async function settingsForEdit(staff: StaffDesk): Promise<DeskSettingsView> {
  const storeId = staff.desk.storeId;
  const [settings, agent, connection] = await Promise.all([ensureDesk(staff.desk), getChatAgentForEdit(storeId), aiFor(storeId)]);
  return { ...settings, aiReady: agent !== null && Boolean(connection?.textModel) };
}

/** The open conversations a new mode cannot serve: with people only, the AI's; with support off, the queue's and people's. */
const unservedBy = (mode: SupportMode) => (mode === "people" ? sql`handler = 'ai'` : mode === "off" ? sql`handler in ('queue', 'human')` : sql`false`);

export type SaveDeskResult = { ok: true; ended: number } | { ok: false; problems: string[] };

/**
 * Saves the desk's settings. Only an owner (`owner`) changes how long transcripts are kept. Changing who answers ends the open
 * conversations the new mode cannot serve (the customer's next message within a day opens it again, as the new mode starts one), in
 * the same transaction; the change is in the activity log.
 */
export async function saveDeskSettings(staff: StaffDesk, raw: unknown, may: { owner: boolean }): Promise<SaveDeskResult> {
  if (!staff.canWrite) return { ok: false, problems: ["You can read this desk's settings but not change them."] };
  const parsed = deskSettingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const input = parsed.data;
  const current = await ensureDesk(staff.desk);
  const transcriptDays = input.transcriptDays ?? current.transcriptDays;
  if (transcriptDays !== current.transcriptDays && !may.owner) return { ok: false, problems: ["Only the store's owner can change how long transcripts are kept."] };

  const storeId = staff.desk.storeId;
  const desk = storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`;
  const ended = await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.support_settings set
        mode = ${input.mode}, email_followup = ${input.emailFollowup}, hours = ${input.hours ? JSON.stringify(input.hours) : null}::jsonb,
        end_after_minutes = ${input.endAfterMinutes}, notify_after_minutes = ${input.notifyAfterMinutes}, agent_naming = ${input.agentNaming},
        tone_on = ${input.toneOn}, tone_alert = ${input.toneAlert}, tone_handoff = ${input.toneHandoff},
        transcript_days = ${transcriptDays}, updated_at = now(), updated_by = ${staff.account.id}::uuid
      where ${desk}
    `);
    if (input.mode === current.mode) return 0;
    const open = await tx.execute<Row>(sql`
      select id from commerce.support_conversations where ${desk} and status = 'open' and anonymised_at is null and ${unservedBy(input.mode)}
    `);
    for (const row of open) await tx.execute(sql`select commerce.support_transition(${String(row.id)}::uuid, 'end', 'system', null, null, 'system', null)`);
    return open.length;
  });

  const changed = (
    [
      ["mode", current.mode, input.mode],
      ["email_followup", current.emailFollowup, input.emailFollowup],
      ["hours", JSON.stringify(current.hours), JSON.stringify(input.hours)],
      ["end_after_minutes", current.endAfterMinutes, input.endAfterMinutes],
      ["notify_after_minutes", current.notifyAfterMinutes, input.notifyAfterMinutes],
      ["agent_naming", current.agentNaming, input.agentNaming],
      ["tone_on", current.toneOn, input.toneOn],
      ["tone_alert", current.toneAlert, input.toneAlert],
      ["tone_handoff", current.toneHandoff, input.toneHandoff],
      ["transcript_days", current.transcriptDays, transcriptDays],
    ] as const
  )
    .filter(([, before, after]) => before !== after)
    .map(([field]) => field);
  if (changed.length > 0) {
    await audit(staff.account.id, storeId, "support.settings_changed", { fields: changed, ...(input.mode !== current.mode ? { mode: input.mode, ended } : {}) }, {
      area: "support",
      target: { type: "support_desk", id: storeId ?? "kaizen" },
    });
  }
  return { ok: true, ended };
}
