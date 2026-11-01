import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { audit, type Account } from "./auth";
import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * The platform-wide pause of every AI that acts on its own (PSI AST-07): autopilot steps, reactions to events, goal reviews, the AI
 * manager's follow-ups and Dream Factory runs each stop at their next run while it is on, and go on where they were when it is off.
 * People still use the AI themselves (the chat, the AI manager, writing with AI): only what no person started waits. A platform admin's
 * switch on Platform → AI, audited.
 */
export async function aiAutonomyPaused(): Promise<boolean> {
  const row = await typedRow(z.object({ paused: col.bool }), sql`select coalesce((select ai_autonomy_paused from commerce.platform_settings limit 1), false) as paused`);
  return row?.paused ?? false;
}

/** A runner's first question: true when it should do nothing this run, logged once a run so a paused minute is not a silent one. */
export async function skipWhilePaused(runner: string): Promise<boolean> {
  if (!(await aiAutonomyPaused())) return false;
  log("info", "ai.autonomy_paused", { runner });
  return true;
}

export async function setAiAutonomyPaused(admin: Account, paused: boolean): Promise<void> {
  await db().execute(sql`
    insert into commerce.platform_settings (id, ai_autonomy_paused) values (true, ${paused})
    on conflict (id) do update set ai_autonomy_paused = excluded.ai_autonomy_paused
  `);
  await audit(admin.id, null, "platform.ai_autonomy_paused", { paused });
}
