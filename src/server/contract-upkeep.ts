import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { cutoffInstant } from "@/lib/retention";

import { notifyNext, type Mailer } from "./contract-signing";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { retentionRule } from "./retention";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The contracts' upkeep (D695 step 3, D795), a job of the five-minute dispatcher (`DISPATCHER_JOBS.contracts`): the contracts whose
 * time to sign has passed, reminders to a signer who has not signed, used and lapsed codes, and signed contracts past their retention
 * period with their files. No Chromium and no seal here: a signed contract's sealed PDF is the PDF route's (`signedPdfJob()`), asked
 * for by the dispatcher's `documentPdfs` job (`runDocumentPdfAsk()`, D807). One cheap question first, so an idle run is one statement.
 */

const REMINDER_DAYS = 3;
const MAX_REMINDERS = 3;

export type UpkeepDeps = { mail?: Mailer; now?: Date; storage?: DocumentStorage | null };
export type UpkeepResult = { expired: number; reminded: number; codes: number; pruned: number };

const WORK = z.object({ sent: col.bool, codes: col.bool, signed: col.bool });

/** The upkeep's parts, each caught on its own so one failing leaves the rest done. */
export async function contractUpkeep(deps: UpkeepDeps, work = { sent: true, codes: true, signed: true }): Promise<UpkeepResult> {
  const now = deps.now ?? new Date();
  const result: UpkeepResult = { expired: 0, reminded: 0, codes: 0, pruned: 0 };
  if (work.sent) {
    try {
      const expired = await typedRows(
        z.object({ id: col.uuid }),
        sql`update commerce.contracts set status = 'expired', closed_at = now(), updated_at = now()
            where status = 'sent' and expires_at <= ${now.toISOString()}::timestamptz returning id`,
      );
      result.expired = expired.length;
    } catch (error) {
      log("error", "contracts.job_expire_failed", {}, error);
    }
    try {
      // The signer whose turn it is, on the customer's side, asked at least the contract's reminder days ago (three by default), three times at most.
      const waiting = await typedRows(
        z.object({ store_id: col.uuid, contract_id: col.uuid }),
        sql`
          select g.store_id, g.contract_id from commerce.contract_signers g
          join commerce.contracts c on c.store_id = g.store_id and c.id = g.contract_id
          where c.status = 'sent' and g.role <> 'store' and g.signed_at is null and g.declined_at is null and g.reminders < ${MAX_REMINDERS}
            -- Deals and contracts is a paid extension (D748): no signer is reminded while the account does not have it.
            and commerce.extension_on(g.store_id, 'deals')
            and g.notified_at < ${now.toISOString()}::timestamptz - make_interval(days => coalesce(c.reminder_days, ${REMINDER_DAYS}))
            and not exists (select 1 from commerce.contract_signers e where e.store_id = g.store_id and e.contract_id = g.contract_id
                            and e.position < g.position and e.signed_at is null)
          limit 50`,
      );
      for (const w of waiting) {
        await notifyNext(w.store_id, w.contract_id, { reminder: true, mail: deps.mail });
        result.reminded += 1;
      }
    } catch (error) {
      log("error", "contracts.job_remind_failed", {}, error);
    }
  }
  if (work.codes) {
    try {
      const gone = await typedRows(
        z.object({ id: col.uuid }),
        sql`delete from commerce.contract_codes where (used_at is not null or expires_at < now()) and created_at < ${now.toISOString()}::timestamptz - interval '1 day' returning id`,
      );
      result.codes = gone.length;
    } catch (error) {
      log("error", "contracts.job_codes_failed", {}, error);
    }
  }
  if (work.signed) {
    try {
      result.pruned = await pruneContracts(now, deps.storage === undefined ? documentStorage() : deps.storage);
    } catch (error) {
      log("error", "contracts.job_prune_failed", {}, error);
    }
  }
  return result;
}

/** Signed contracts past the `contracts` retention period (from their signing), deleted with their signers, events and both PDFs. */
export async function pruneContracts(now: Date, storage: Pick<DocumentStorage, "remove"> | null): Promise<number> {
  const period = await retentionRule("contracts", null, now.toISOString().slice(0, 10));
  const before = cutoffInstant(period, now);
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('commerce.contract_retention', 'on', true)`);
    const gone = await typedRows(
      z.object({ store_id: col.uuid, pdf_path: col.textOrNull, signed_pdf_path: col.textOrNull }),
      sql`delete from commerce.contracts where status = 'signed' and completed_at < ${before.toISOString()}::timestamptz
          returning store_id, pdf_path, signed_pdf_path`,
      tx,
    );
    const files = gone.flatMap((g) => [g.pdf_path, g.signed_pdf_path].filter((p): p is string => typeof p === "string" && p.startsWith(`${g.store_id}/contracts/`)));
    if (files.length > 0 && storage && !(await storage.remove(files))) log("error", "contracts.prune_files_left", { files: files.length });
    return gone.length;
  });
}

/**
 * The dispatcher's run (D795): one question says what waits; only that is done. Retention is looked at in the first five minutes of
 * each hour only. A signed contract waiting for its seal is the PDF job's, asked for by `runDocumentPdfAsk()` (D807).
 */
export async function runContractUpkeep(now = new Date()): Promise<UpkeepResult> {
  const work = await typedRow(
    WORK,
    sql`select
          exists (select 1 from commerce.contracts where status = 'sent') as sent,
          exists (select 1 from commerce.contract_codes) as codes,
          exists (select 1 from commerce.contracts where status = 'signed') as signed`,
  );
  if (!work) return { expired: 0, reminded: 0, codes: 0, pruned: 0 };
  return contractUpkeep({ now }, { sent: work.sent, codes: work.codes, signed: work.signed && now.getUTCMinutes() < 5 });
}
