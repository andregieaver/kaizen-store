import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { classOfAction, classOfDecision, classOfReply, noInterventions, type InterventionClass, type InterventionCounts } from "@/lib/interventions";
import { escalationOf } from "@/lib/support-rules";

import { col, typedRows } from "./typed-rows";

/**
 * The intervention log of a store over a period (`docs/100-day-challenge.md` A5): the actions people took, counted by class, and each
 * one of class `other` listed (the challenge allows none). Read from the audit log (`acted_by = 'person'`), the calls the autopilot kept that a
 * person decided, and the people's answers on the support desk. Ids and actions only, never what a customer wrote.
 */
export type Intervention = { at: string; cls: InterventionClass; what: string; ref: string | null };

export async function interventionsOf(storeId: string, from: Date, to: Date): Promise<{ counts: InterventionCounts; other: Intervention[] }> {
  const [actions, decisions, replies] = await Promise.all([
    typedRows(
      z.object({ at: col.timestamp, action: col.text, platform_admin: col.bool, id: col.text }),
      sql`
        select l.created_at as at, l.action, coalesce(a.platform_admin, false) as platform_admin, l.id::text as id
        from commerce.audit_log l left join commerce.accounts a on a.id = l.account_id
        where l.store_id = ${storeId}::uuid and l.acted_by = 'person' and l.created_at >= ${from.toISOString()}::timestamptz and l.created_at < ${to.toISOString()}::timestamptz
      `,
    ),
    typedRows(
      z.object({ at: col.timestamp, tool: col.text, id: col.text }),
      sql`
        select ap.decided_at as at, ap.tool, ap.id::text as id from commerce.assistant_approvals ap
        join commerce.assistant_conversations c on c.id = ap.conversation_id and c.source = 'autopilot'
        where ap.store_id = ${storeId}::uuid and ap.status in ('done', 'declined', 'failed') and ap.decided_at >= ${from.toISOString()}::timestamptz and ap.decided_at < ${to.toISOString()}::timestamptz
      `,
    ),
    typedRows(
      z.object({ at: col.timestamp, handoff_reason: col.textOrNull, escalation: col.textOrNull, id: col.text }),
      sql`
        select m.created_at as at, c.handoff_reason, c.escalation, c.id::text as id from commerce.support_messages m
        join commerce.support_conversations c on c.id = m.conversation_id
        where c.store_id = ${storeId}::uuid and m.author = 'agent' and m.created_at >= ${from.toISOString()}::timestamptz and m.created_at < ${to.toISOString()}::timestamptz
      `,
    ),
  ]);
  const counts = noInterventions();
  const other: Intervention[] = [];
  const count = (cls: InterventionClass, entry: Intervention) => {
    counts[cls]++;
    if (cls === "other") other.push(entry);
  };
  for (const a of actions) {
    const cls = classOfAction(a.action, a.platform_admin);
    if (cls) count(cls, { at: a.at, cls, what: a.action, ref: a.id });
  }
  for (const d of decisions) {
    const cls = classOfDecision(d.tool);
    count(cls, { at: d.at, cls, what: `decided ${d.tool}`, ref: d.id });
  }
  for (const r of replies) {
    const cls = classOfReply(escalationOf(r.handoff_reason, r.escalation) !== null);
    count(cls, { at: r.at, cls, what: "answered a customer", ref: r.id });
  }
  other.sort((a, b) => a.at.localeCompare(b.at));
  return { counts, other };
}
