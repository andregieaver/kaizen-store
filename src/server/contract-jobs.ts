import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { ContractAudit } from "@/components/documents/contract-document-view";
import { signingText } from "@/lib/contract-signing-text";
import { renderEmail } from "@/lib/email-layout";
import { cutoffInstant } from "@/lib/retention";

import { notifyNext, type Mailer } from "./contract-signing";
import { appendPages, platformSeal, sealPdf } from "./contract-seal";
import { contractPdfPath, type PdfRenderer } from "./contracts";
import { contractAuditHtml } from "./document-html";
import { sendEmail } from "./email";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { retentionRule } from "./retention";
import { emailContext, emailFooter, storeById } from "./shopper-emails";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The contracts' jobs (D695 step 3), run with the PDFs of invoices from `/api/cron/document-pdfs`, which carries Chromium and hands its
 * renderer in: the signed PDF of each contract everyone has signed (the sent PDF, checked against its SHA-256, the signing record's page
 * after it, sealed, kept once, emailed to every signer), the contracts whose time to sign has passed, reminders to a signer who has not
 * signed, used and lapsed codes, and signed contracts past their retention period, with their files.
 */

export type JobDeps = { render: PdfRenderer; storage?: DocumentStorage | null; mail?: Mailer; now?: Date };

const ATTEMPTS = 5;
const PER_RUN = 3;
const REMINDER_DAYS = 3;
const MAX_REMINDERS = 3;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const contractRow = z.object({
  store_id: col.uuid,
  id: col.uuid,
  title: col.text,
  language: col.text,
  pdf_path: col.text,
  pdf_sha256: col.text,
  sent_at: col.timestamp,
  completed_at: col.timestamp,
  time_zone: col.textOrNull,
});
const signerRow = z.object({
  id: col.uuid,
  role: z.enum(["store", "customer", "other"]),
  name: col.text,
  email: col.text,
  signed_name: col.text,
  signed_at: col.timestamp,
  method: col.textOrNull,
  ip: col.textOrNull,
});
const eventRow = z.object({ kind: col.text, at: col.timestamp, who: col.textOrNull, ip: col.textOrNull });

/**
 * The signed PDF of one signed contract: never made twice (the database sets it once), and a failure counted so the job tries again in
 * five minutes, five times at most. Returns whether it was made now.
 */
export async function buildSignedPdf(storeId: string, contractId: string, deps: JobDeps): Promise<boolean> {
  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  const c = await typedRow(
    contractRow,
    sql`
      select k.store_id, k.id, k.title, k.language, k.pdf_path, k.pdf_sha256, k.sent_at, k.completed_at, s.time_zone
      from commerce.contracts k join commerce.stores s on s.id = k.store_id
      where k.store_id = ${storeId}::uuid and k.id = ${contractId}::uuid and k.status = 'signed' and k.signed_pdf_path is null
    `,
  );
  if (!c || !storage) return false;
  try {
    const sent = await storage.download(c.pdf_path);
    if (!sent || sha256(sent) !== c.pdf_sha256) throw new Error("The sent PDF is missing or not the one that was signed.");
    const seal = await platformSeal();
    if (!seal) throw new Error("No seal: SETTINGS_ENCRYPTION_KEY is not set.");
    const signers = await typedRows(
      signerRow,
      sql`select id, role, name, email, signed_name, signed_at, evidence->>'method' as method, ip from commerce.contract_signers
          where store_id = ${storeId}::uuid and contract_id = ${contractId}::uuid order by position`,
    );
    const events = await typedRows(
      eventRow,
      sql`select e.kind, e.at, g.name as who, e.ip from commerce.contract_events e
          left join commerce.contract_signers g on g.id = e.signer_id
          where e.store_id = ${storeId}::uuid and e.contract_id = ${contractId}::uuid order by e.at, e.id`,
    );
    const audit: ContractAudit = {
      title: c.title,
      language: c.language,
      contractId: c.id,
      documentSha256: c.pdf_sha256,
      sentAt: c.sent_at,
      completedAt: c.completed_at,
      timeZone: c.time_zone ?? "Europe/Oslo",
      signers: signers.map((s) => ({
        role: s.role,
        name: s.name,
        email: s.email,
        signedName: s.signed_name,
        signedAt: s.signed_at,
        method: s.method === "admin_session" ? "admin_session" : "email_code",
        ip: s.ip,
      })),
      events: events.map((e) => ({ kind: e.kind as ContractAudit["events"][number]["kind"], at: e.at, who: e.who, ip: e.ip })),
      sealFingerprint: seal.fingerprint,
    };
    const record = await deps.render(contractAuditHtml(audit));
    const whole = await appendPages(sent, record);
    const sealed = await sealPdf(whole, seal, { reason: "Signed by all parties", location: "Kaizena Flow", signingTime: deps.now ?? new Date() });
    if (sealed.length === 0 || sealed.length > MAX_PDF_BYTES) throw new Error("The signed PDF was empty or too large.");
    const path = contractPdfPath(storeId, contractId, true);
    if (!(await storage.upload(path, sealed, "application/pdf"))) {
      // A file from a run that stopped before the row was set: nobody has been given it, so it is replaced.
      await storage.remove([path]);
      if (!(await storage.upload(path, sealed, "application/pdf"))) throw new Error("The signed PDF could not be kept.");
    }
    const set = await typedRows(
      z.object({ id: col.uuid }),
      sql`update commerce.contracts set signed_pdf_path = ${path}, signed_pdf_sha256 = ${sha256(sealed)}, updated_at = now()
          where store_id = ${storeId}::uuid and id = ${contractId}::uuid and signed_pdf_path is null returning id`,
    );
    if (set.length === 0) return false;
    await sendSigned(storeId, contractId, c.title, c.language, sealed, deps);
    return true;
  } catch (error) {
    log("error", "contracts.signed_pdf_failed", { contractId }, error);
    await db().execute(sql`
      update commerce.contracts set signed_pdf_attempts = signed_pdf_attempts + 1, signed_pdf_tried_at = now()
      where store_id = ${storeId}::uuid and id = ${contractId}::uuid and signed_pdf_path is null
    `);
    return false;
  }
}

/** Every signer gets the signed contract, attached, once. */
async function sendSigned(storeId: string, contractId: string, title: string, language: string, pdf: Uint8Array, deps: JobDeps) {
  const store = await storeById(storeId);
  const home = store?.markets[0];
  if (!store || !home) return;
  const ctx = await emailContext(storeId, home.code, language === "nb" ? "nb-NO" : "en-GB");
  if (!ctx) return;
  const w = signingText(language).signed;
  const signers = await typedRows(
    z.object({ id: col.uuid, email: col.text }),
    sql`select id, email from commerce.contract_signers where store_id = ${storeId}::uuid and contract_id = ${contractId}::uuid order by position`,
  );
  const email = renderEmail({
    subject: w.subject(title),
    preview: w.intro(title),
    blocks: [
      { type: "heading", text: w.heading },
      { type: "paragraph", text: w.intro(title) },
      { type: "paragraph", text: w.attached },
    ],
    footer: emailFooter(store, ctx.text),
    lang: language,
  });
  const fileName = `${title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "contract"}.pdf`;
  for (const s of signers) {
    await (deps.mail ?? sendEmail)({
      storeId,
      kind: "contract.signed",
      to: s.email,
      email,
      fromName: store.name,
      replyTo: store.details.contactEmail,
      idempotencyKey: `contract-signed:${s.id}`,
      attachments: [{ filename: fileName, content: Buffer.from(pdf).toString("base64"), contentType: "application/pdf", encoding: "base64" }],
    });
  }
}

export type ContractJobResult = { signedPdfs: number; expired: number; reminded: number; codes: number; pruned: number };

/** One run of the contracts' jobs; each part is caught on its own so one failing leaves the rest done. */
export async function contractJob(deps: JobDeps): Promise<ContractJobResult> {
  const now = deps.now ?? new Date();
  const result: ContractJobResult = { signedPdfs: 0, expired: 0, reminded: 0, codes: 0, pruned: 0 };

  try {
    const due = await typedRows(
      z.object({ store_id: col.uuid, id: col.uuid }),
      sql`select store_id, id from commerce.contracts
          where status = 'signed' and signed_pdf_path is null and signed_pdf_attempts < ${ATTEMPTS}
            and (signed_pdf_tried_at is null or signed_pdf_tried_at < ${now.toISOString()}::timestamptz - interval '5 minutes')
          order by completed_at limit ${PER_RUN}`,
    );
    for (const c of due) if (await buildSignedPdf(c.store_id, c.id, { ...deps, now })) result.signedPdfs += 1;
  } catch (error) {
    log("error", "contracts.job_signed_failed", {}, error);
  }

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

  try {
    const gone = await typedRows(
      z.object({ id: col.uuid }),
      sql`delete from commerce.contract_codes where (used_at is not null or expires_at < now()) and created_at < ${now.toISOString()}::timestamptz - interval '1 day' returning id`,
    );
    result.codes = gone.length;
  } catch (error) {
    log("error", "contracts.job_codes_failed", {}, error);
  }

  try {
    result.pruned = await pruneContracts(now, deps.storage === undefined ? documentStorage() : deps.storage);
  } catch (error) {
    log("error", "contracts.job_prune_failed", {}, error);
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
