import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { ContractAudit } from "@/components/documents/contract-document-view";
import { signingText } from "@/lib/contract-signing-text";
import { renderEmail } from "@/lib/email-layout";

import type { Mailer } from "./contract-signing";
import { appendPages, platformSeal, sealPdf } from "./contract-seal";
import { contractPdfPath, type PdfRenderer } from "./contracts";
import { contractUpkeep, type UpkeepResult } from "./contract-upkeep";
import { contractAuditHtml } from "./document-html";
import { sendEmail } from "./email";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { emailContext, emailFooter, storeById } from "./shopper-emails";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The contracts' sealed PDFs (D695 step 3), made by `/api/cron/document-pdfs`, which carries Chromium and hands its renderer in: the
 * signed PDF of each contract everyone has signed (the sent PDF, checked against its SHA-256, the signing record's page after it,
 * sealed, kept once, emailed to every signer). The dispatcher asks the route when one waits (`runContractUpkeep()`, D795); the upkeep
 * that needs no Chromium (expiry, reminders, codes, retention) is `src/server/contract-upkeep.ts`.
 */

export type JobDeps = { render: PdfRenderer; storage?: DocumentStorage | null; mail?: Mailer; now?: Date };

const ATTEMPTS = 5;
const PER_RUN = 3;
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

/** Signed contracts waiting for their sealed PDF, at most `PER_RUN` a run, each tried again five minutes after a failure. */
export async function signedPdfJob(deps: JobDeps): Promise<number> {
  const now = deps.now ?? new Date();
  let made = 0;
  try {
    const due = await typedRows(
      z.object({ store_id: col.uuid, id: col.uuid }),
      sql`select store_id, id from commerce.contracts
          where status = 'signed' and signed_pdf_path is null and signed_pdf_attempts < ${ATTEMPTS}
            and (signed_pdf_tried_at is null or signed_pdf_tried_at < ${now.toISOString()}::timestamptz - interval '5 minutes')
          order by completed_at limit ${PER_RUN}`,
    );
    for (const c of due) if (await buildSignedPdf(c.store_id, c.id, { ...deps, now })) made += 1;
  } catch (error) {
    log("error", "contracts.job_signed_failed", {}, error);
  }
  return made;
}

export type ContractJobResult = { signedPdfs: number } & UpkeepResult;

/** The sealed PDFs and the upkeep in one run, as a test runs them; production runs the upkeep in the dispatcher (D795). */
export async function contractJob(deps: JobDeps): Promise<ContractJobResult> {
  const signedPdfs = await signedPdfJob(deps);
  return { signedPdfs, ...(await contractUpkeep(deps)) };
}

