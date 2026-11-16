import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { can } from "@/lib/permissions";

import { audit, type Account, type Membership } from "./auth";
import { log } from "./log";
import { filesOf, removeFiles, STORED, type RecordingDeps } from "./recordings";
import { col, typedRows } from "./typed-rows";

/**
 * The owner's own actions on recordings of visits (D656), apart from the ingest so the storefront's beacon route loads no sign-in module.
 */

/** The owner deletes one recording (audited). */
export async function deleteRecording(member: Membership, id: string, deps: RecordingDeps = {}): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!can({ role: member.role }, "owner")) return { ok: false, problem: "Only the store's owner can delete recordings." };
  const files = filesOf(deps);
  if (!files) {
    log("warn", "recordings.no_storage", { action: "delete" });
    return { ok: false, problem: "Recordings cannot be deleted right now. Try again later." };
  }
  const gone = await typedRows(
    STORED,
    sql`delete from commerce.recordings where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id, store_id, sealed, seqs`,
  );
  await removeFiles(files, gone);
  if (gone.length > 0) await audit(member.account.id, member.store.id, "analytics.recording_deleted", {});
  return { ok: true };
}

/** Whether recordings are open to every store (D656); while closed only Kaizena Flow's own house store records. */
export async function recordingsOpenNow(): Promise<boolean> {
  const rows = await typedRows(z.object({ open: col.bool }), sql`select recordings_open as open from commerce.platform_settings limit 1`);
  return rows[0]?.open ?? false;
}

/** Opens or closes recordings to every store (the platform's owner role writes `settings`; audited). */
export async function setRecordingsOpen(account: Account, open: boolean): Promise<void> {
  await db().execute(sql`update commerce.platform_settings set recordings_open = ${open}`);
  await audit(account.id, null, "platform.recordings_open_set", { open });
}
