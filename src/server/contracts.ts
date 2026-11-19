import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  draftBlocks,
  fillContract,
  parseBlocks,
  type BlocksProblem,
  type ContractBlock,
  type ContractFacts,
  type ContractField,
  type ContractSnapshot,
  type FillProblem,
  type SnapshotSigner,
} from "@/lib/contract-fields";
import { starterTemplate } from "@/lib/contract-templates";
import { dateIn } from "@/lib/dates";
import { normaliseEmail } from "@/lib/email-address";
import { formatMoney } from "@/lib/money";
import { addressText } from "@/lib/work-input";

import { audit, type Membership } from "./auth";
import { contractHtml } from "./document-html";
import { computeDraft } from "./draft-orders";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { owned } from "./owned";
import { memberCan } from "./permissions";
import { uuidList } from "./sql-arrays";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Contracts for deals (D695, `docs/contracts.md`): the one reader and writer of a store's contract templates and contracts for staff. A
 * contract is made as a draft from a template on a deal, with the deal's owner (or the one who made it) as the store's signer and the
 * deal's person as the customer's; staff change its words and signers while it is a draft. Sending fills every field from the deal, its
 * person and company, the linked quote and the store (`fillContract()`: a field with no value stops the send), draws the PDF from that
 * snapshot, keeps the file once in the private `documents` bucket and freezes snapshot, file and SHA-256 together; the database then holds
 * the document (D695's rules). Read with `customers:read`, written with `customers:write`, as deals are. Audited as `contract.*` with ids.
 *
 * Step 1 sends nothing to anyone: the signing page and its emails are step 3. Until then nothing in the admin calls `sendContract()`.
 */

/** A row that is only an id: what a write returns. */
const ID = z.object({ id: col.uuid });

const READ = "customers:read" as const;
const WRITE = "customers:write" as const;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const DAY_MS = 86_400_000;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Where a contract's PDF is kept in the `documents` bucket: beside the store's invoices, under its own folder. */
export const contractPdfPath = (storeId: string, contractId: string, signed = false): string =>
  `${storeId}/contracts/${contractId}${signed ? "-signed" : ""}.pdf`;

export type ContractStatus = "draft" | "sent" | "signed" | "declined" | "expired" | "cancelled";
export type SignerRole = "store" | "customer" | "other";

export type ContractTemplate = {
  id: string;
  name: string;
  language: string;
  blocks: ContractBlock[];
  version: number;
  expiresDays: number;
  /** Days between reminders to a signer who has not signed, or null for the default (three). */
  reminderDays: number | null;
  /** Contracts made from it. */
  used: number;
};

export type ContractSigner = {
  id: string;
  role: SignerRole;
  position: number;
  name: string;
  email: string;
  accountId: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
};

export type Contract = {
  id: string;
  /** Null only for a signed contract whose deal was deleted (it is kept for its retention period). */
  dealId: string | null;
  title: string;
  language: string;
  status: ContractStatus;
  blocks: ContractBlock[];
  snapshot: ContractSnapshot | null;
  sentAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  replacesId: string | null;
  /** The signed and sealed PDF is made (D695 step 3). */
  signedPdf: boolean;
  signers: ContractSigner[];
};

export type ContractProblem = "forbidden" | "not_found" | "not_draft" | "title" | "blocks" | "signers" | "pdf_failed" | "deal_closed";
export type ContractResult = { ok: true; id: string } | { ok: false; problem: ContractProblem; blocks?: BlocksProblem[] };
export type SendResult = ContractResult | { ok: false; problem: "unfilled"; fill: FillProblem[] };

// ---------------------------------------------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------------------------------------------

const templateRow = z.object({
  id: col.uuid,
  name: col.text,
  language: col.text,
  blocks: z.unknown(),
  version: col.int,
  expires_days: col.int,
  reminder_days: col.int.nullable(),
  used: col.int,
});
const toTemplate = (r: z.output<typeof templateRow>): ContractTemplate => {
  const parsed = parseBlocks(r.blocks);
  return {
    id: r.id,
    name: r.name,
    language: r.language,
    blocks: parsed.ok ? parsed.blocks : [],
    version: r.version,
    expiresDays: r.expires_days,
    reminderDays: r.reminder_days,
    used: r.used,
  };
};

/** The store's templates in use, oldest first. */
export async function listTemplates(storeId: string): Promise<ContractTemplate[]> {
  const rows = await typedRows(
    templateRow,
    sql`select t.id, t.name, t.language, t.blocks, t.version, t.expires_days, t.reminder_days,
          (select count(*)::int from commerce.contracts c where c.store_id = t.store_id and c.template_id = t.id) as used
        from commerce.contract_templates t
        where ${owned(storeId, sql`t.store_id`)} and t.archived_at is null order by t.created_at, t.id`,
  );
  return rows.map(toTemplate);
}

/**
 * The store's templates, making Homer's first one on the first visit, in the store's main language (`starterTemplate()`). Two visits at
 * once make one: the second waits on the store's lock and finds it.
 */
export async function ensureTemplate(store: Store, accountId: string | null): Promise<ContractTemplate[]> {
  const have = await listTemplates(store.id);
  if (have.length > 0) return have;
  const starter = starterTemplate(store.markets[0]?.locale ?? "en");
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`contract-template:${store.id}`}, 0))`);
    const any = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.contract_templates where ${owned(store.id)} limit 1`, tx);
    if (any) return;
    await tx.execute(sql`
      insert into commerce.contract_templates (store_id, name, language, blocks, created_by)
      values (${store.id}::uuid, ${starter.name}, ${starter.language}, ${JSON.stringify(starter.blocks)}::jsonb, ${accountId}::uuid)
    `);
  });
  return listTemplates(store.id);
}

/** One of the store's templates in use (`customers:read`), or null. */
export async function getTemplate(member: Membership, templateId: string): Promise<ContractTemplate | null> {
  if (!memberCan(member, READ)) return null;
  return (await listTemplates(member.store.id)).find((t) => t.id === templateId) ?? null;
}

export type TemplateProblem = "forbidden" | "not_found" | "name" | "taken" | "language" | "blocks" | "days" | "last";
export type TemplateResult = { ok: true; id: string } | { ok: false; problem: TemplateProblem; blocks?: BlocksProblem[] };

const templateInput = z.object({
  name: z.string().trim().min(1).max(80),
  language: z.enum(["nb", "en"]),
  expiresDays: z.coerce.number().int().min(1).max(365),
  reminderDays: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(60)]).transform((v) => (v === "" ? null : v)),
});

const nameTaken = (error: unknown) => error instanceof Error && /contract_templates_name_key/.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`);

/** A new template (`customers:write`): the starter in the language asked, named so no other template in use has its name. */
export async function createTemplate(member: Membership, language: "nb" | "en"): Promise<TemplateResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const starter = starterTemplate(language === "nb" ? "nb-NO" : "en-GB");
  const names = new Set((await listTemplates(member.store.id)).map((t) => t.name.toLowerCase()));
  let name = starter.name;
  for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${starter.name} ${n}`;
  const made = await typedRows(
    ID,
    sql`insert into commerce.contract_templates (store_id, name, language, blocks, created_by)
        values (${member.store.id}::uuid, ${name}, ${starter.language}, ${JSON.stringify(starter.blocks)}::jsonb, ${member.account.id}::uuid) returning id`,
  );
  await audit(member.account.id, member.store.id, "contract.template_created", { template: made[0].id }, { area: "customers" });
  return { ok: true, id: made[0].id };
}

/**
 * A template's name, language, words, days to sign and reminder days changed (`customers:write`). Its version rises when its words do;
 * contracts made from it keep the version they were made from.
 */
export async function saveTemplate(
  member: Membership,
  templateId: string,
  raw: { name: unknown; language: unknown; blocks: unknown; expiresDays: unknown; reminderDays: unknown },
): Promise<TemplateResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const input = templateInput.safeParse(raw);
  if (!input.success) {
    const at = String(input.error.issues[0]?.path[0] ?? "");
    return { ok: false, problem: at === "name" ? "name" : at === "language" ? "language" : "days" };
  }
  const blocks = parseBlocks(raw.blocks);
  if (!blocks.ok) return { ok: false, problem: "blocks", blocks: blocks.problems };
  try {
    const set = await typedRows(
      ID,
      sql`update commerce.contract_templates set name = ${input.data.name}, language = ${input.data.language}, blocks = ${JSON.stringify(blocks.blocks)}::jsonb,
            expires_days = ${input.data.expiresDays}, reminder_days = ${input.data.reminderDays}, updated_at = now()
          where store_id = ${member.store.id}::uuid and id = ${templateId}::uuid and archived_at is null returning id`,
    );
    if (set.length === 0) return { ok: false, problem: "not_found" };
  } catch (error) {
    if (nameTaken(error)) return { ok: false, problem: "taken" };
    throw error;
  }
  await audit(member.account.id, member.store.id, "contract.template_saved", { template: templateId }, { area: "customers" });
  return { ok: true, id: templateId };
}

/** A template put away (`customers:write`): kept for the contracts made from it, never offered again; the last one in use stays. */
export async function archiveTemplate(member: Membership, templateId: string): Promise<TemplateResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const all = await listTemplates(member.store.id);
  if (!all.some((t) => t.id === templateId)) return { ok: false, problem: "not_found" };
  if (all.length <= 1) return { ok: false, problem: "last" };
  await db().execute(sql`
    update commerce.contract_templates set archived_at = now(), updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${templateId}::uuid and archived_at is null
  `);
  await audit(member.account.id, member.store.id, "contract.template_archived", { template: templateId }, { area: "customers" });
  return { ok: true, id: templateId };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------------------

const contractRow = z.object({
  id: col.uuid,
  deal_id: col.uuid.nullable(),
  title: col.text,
  language: col.text,
  status: z.enum(["draft", "sent", "signed", "declined", "expired", "cancelled"]),
  blocks: z.unknown(),
  snapshot: z.unknown().nullable(),
  sent_at: col.timestampOrNull,
  expires_at: col.timestampOrNull,
  completed_at: col.timestampOrNull,
  replaces_id: col.uuid.nullable(),
  signed_pdf: col.bool,
});
const signerRow = z.object({
  id: col.uuid,
  contract_id: col.uuid,
  role: z.enum(["store", "customer", "other"]),
  position: col.int,
  name: col.text,
  email: col.text,
  account_id: col.uuid.nullable(),
  viewed_at: col.timestampOrNull,
  signed_at: col.timestampOrNull,
  declined_at: col.timestampOrNull,
});

async function readContracts(storeId: string, where: ReturnType<typeof sql>): Promise<Contract[]> {
  const rows = await typedRows(
    contractRow,
    sql`select id, deal_id, title, language, status, blocks, snapshot, sent_at, expires_at, completed_at, replaces_id, signed_pdf_path is not null as signed_pdf
        from commerce.contracts where ${owned(storeId)} and ${where} order by created_at, id`,
  );
  if (rows.length === 0) return [];
  const signers = await typedRows(
    signerRow,
    sql`select id, contract_id, role, position, name, email, account_id, viewed_at, signed_at, declined_at
        from commerce.contract_signers where ${owned(storeId)} and contract_id = any(${uuidList(rows.map((r) => r.id))})
        order by position`,
  );
  return rows.map((r) => {
    const parsed = parseBlocks(r.blocks);
    return {
      id: r.id,
      dealId: r.deal_id,
      title: r.title,
      language: r.language,
      status: r.status,
      blocks: parsed.ok ? parsed.blocks : [],
      snapshot: (r.snapshot as ContractSnapshot | null) ?? null,
      sentAt: r.sent_at,
      expiresAt: r.expires_at,
      completedAt: r.completed_at,
      replacesId: r.replaces_id,
      signedPdf: r.signed_pdf,
      signers: signers
        .filter((g) => g.contract_id === r.id)
        .map((g) => ({
          id: g.id, role: g.role, position: g.position, name: g.name, email: g.email, accountId: g.account_id,
          viewedAt: g.viewed_at, signedAt: g.signed_at, declinedAt: g.declined_at,
        })),
    };
  });
}

/** A deal's contracts, oldest first (`customers:read`). */
export async function contractsOfDeal(member: Membership, dealId: string): Promise<Contract[]> {
  if (!memberCan(member, READ)) return [];
  return readContracts(member.store.id, sql`deal_id = ${dealId}::uuid`);
}

/** One contract of the store (`customers:read`), or null. */
export async function getContract(member: Membership, contractId: string): Promise<Contract | null> {
  if (!memberCan(member, READ)) return null;
  const [found] = await readContracts(member.store.id, sql`id = ${contractId}::uuid`);
  return found ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------------------------------------------------------------

const dealRow = z.object({
  id: col.uuid,
  title: col.text,
  status: z.enum(["open", "won", "lost"]),
  owner_id: col.uuid.nullable(),
  owner_active: col.bool,
  owner_name: col.textOrNull,
  owner_email: col.textOrNull,
  customer_name: col.textOrNull,
  customer_email: col.textOrNull,
});

const dealOf = (storeId: string, dealId: string) =>
  typedRow(
    dealRow,
    sql`
      select d.id, d.title, d.status, d.owner_id,
        exists (select 1 from commerce.store_members m where m.store_id = d.store_id and m.account_id = d.owner_id and m.disabled_at is null
          and (m.expires_at is null or m.expires_at > now())) as owner_active,
        nullif(btrim(coalesce(a.name, '')), '') as owner_name, a.email as owner_email,
        nullif(btrim(c.name), '') as customer_name, c.email as customer_email
      from commerce.deals d
      left join commerce.accounts a on a.id = d.owner_id
      left join commerce.customers c on c.store_id = d.store_id and c.id = d.customer_id
      where d.store_id = ${storeId}::uuid and d.id = ${dealId}::uuid
    `,
  );

const accountRow = z.object({ name: col.textOrNull, email: col.text });
const accountOf = (accountId: string) =>
  typedRow(accountRow, sql`select nullif(btrim(coalesce(name, '')), '') as name, email from commerce.accounts where id = ${accountId}::uuid`);

/**
 * A new draft on a deal (`customers:write`) from one of the store's templates (the first when none is named): its blocks with every
 * optional clause included, titled as the deal. The store's signer is the deal's owner while they are an active member, else the one who
 * made it (the owner's answer, 16 November 2026); the customer's signer is the deal's person, when it has one with an address.
 */
export async function createContract(member: Membership, dealId: string, templateId: string | null = null): Promise<ContractResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const deal = await dealOf(member.store.id, dealId);
  if (!deal) return { ok: false, problem: "not_found" };
  const templates = await ensureTemplate(member.store, member.account.id);
  const template = templateId ? templates.find((t) => t.id === templateId) : templates[0];
  if (!template) return { ok: false, problem: "not_found" };

  const storeSigner =
    deal.owner_id && deal.owner_active && deal.owner_email
      ? { accountId: deal.owner_id, name: deal.owner_name ?? deal.owner_email, email: deal.owner_email }
      : await accountOf(member.account.id).then((a) => (a ? { accountId: member.account.id, name: a.name ?? a.email, email: a.email } : null));
  if (!storeSigner) return { ok: false, problem: "signers" };

  const id = await db().transaction(async (tx) => {
    const made = await typedRows(ID, sql`
      insert into commerce.contracts (store_id, deal_id, template_id, title, language, blocks, reminder_days, created_by, updated_by)
      values (${member.store.id}::uuid, ${dealId}::uuid, ${template.id}::uuid, ${deal.title}, ${template.language},
        ${JSON.stringify(draftBlocks(template.blocks))}::jsonb, ${template.reminderDays}, ${member.account.id}::uuid, ${member.account.id}::uuid)
      returning id
    `, tx);
    const contractId = made[0].id;
    await tx.execute(sql`
      insert into commerce.contract_signers (store_id, contract_id, role, position, name, email, account_id)
      values (${member.store.id}::uuid, ${contractId}::uuid, 'store', 0, ${storeSigner.name.slice(0, 200)}, ${normaliseEmail(storeSigner.email)}, ${storeSigner.accountId}::uuid)
    `);
    if (deal.customer_email) {
      await tx.execute(sql`
        insert into commerce.contract_signers (store_id, contract_id, role, position, name, email)
        values (${member.store.id}::uuid, ${contractId}::uuid, 'customer', 1, ${(deal.customer_name ?? deal.customer_email).slice(0, 200)}, ${normaliseEmail(deal.customer_email)})
      `);
    }
    return contractId;
  });
  await audit(member.account.id, member.store.id, "contract.created", { contract: id, deal: dealId }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id };
}

const draftStatus = (storeId: string, contractId: string) =>
  typedRow(z.object({ status: col.text }), sql`select status from commerce.contracts where store_id = ${storeId}::uuid and id = ${contractId}::uuid`);

/** A draft's title and blocks changed (`customers:write`): the blocks checked as a template's (`parseBlocks()`). */
export async function saveDraft(member: Membership, contractId: string, raw: { title: unknown; blocks: unknown }): Promise<ContractResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const now = await draftStatus(member.store.id, contractId);
  if (!now) return { ok: false, problem: "not_found" };
  if (now.status !== "draft") return { ok: false, problem: "not_draft" };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (title.length < 1 || title.length > 200) return { ok: false, problem: "title" };
  const blocks = parseBlocks(raw.blocks);
  if (!blocks.ok) return { ok: false, problem: "blocks", blocks: blocks.problems };
  await db().execute(sql`
    update commerce.contracts set title = ${title}, blocks = ${JSON.stringify(blocks.blocks)}::jsonb, updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${contractId}::uuid and status = 'draft'
  `);
  await audit(member.account.id, member.store.id, "contract.saved", { contract: contractId }, { area: "customers" });
  return { ok: true, id: contractId };
}

export type SignerInput = { role: SignerRole; name: string; email: string; accountId: string | null };

const signerInput = z.object({
  role: z.enum(["store", "customer", "other"]),
  name: z.string().trim().min(1).max(200),
  email: z.string().transform(normaliseEmail).pipe(z.email()).pipe(z.string().max(254)),
  accountId: z.uuid().nullable(),
});

/**
 * A draft's signers, in order (`customers:write`): exactly one for the store (a member of it: the deal's owner or another named member)
 * and at least one for the customer, at most ten in all. The database checks the store's signer is an active member.
 */
export async function saveSigners(member: Membership, contractId: string, raw: readonly unknown[]): Promise<ContractResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const parsed = z.array(signerInput).min(2).max(10).safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "signers" };
  const signers = parsed.data.map((s) => ({ ...s, accountId: s.role === "store" ? s.accountId : null }));
  if (signers.filter((s) => s.role === "store").length !== 1 || !signers.some((s) => s.role === "customer") || signers.some((s) => s.role === "store" && !s.accountId)) {
    return { ok: false, problem: "signers" };
  }
  const now = await draftStatus(member.store.id, contractId);
  if (!now) return { ok: false, problem: "not_found" };
  if (now.status !== "draft") return { ok: false, problem: "not_draft" };
  try {
    await db().transaction(async (tx) => {
      await tx.execute(sql`delete from commerce.contract_signers where store_id = ${member.store.id}::uuid and contract_id = ${contractId}::uuid`);
      for (const [position, s] of signers.entries()) {
        await tx.execute(sql`
          insert into commerce.contract_signers (store_id, contract_id, role, position, name, email, account_id)
          values (${member.store.id}::uuid, ${contractId}::uuid, ${s.role}, ${position}, ${s.name}, ${s.email}, ${s.accountId}::uuid)
        `);
      }
    });
  } catch (error) {
    // The store's signer was not an active member of this store (`contract_signers.store`): nothing changed.
    if (error instanceof Error && /contract_signers\.(store|account)/.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`)) {
      return { ok: false, problem: "signers" };
    }
    throw error;
  }
  await audit(member.account.id, member.store.id, "contract.signers_saved", { contract: contractId, signers: signers.length }, { area: "customers" });
  return { ok: true, id: contractId };
}

/** A draft deleted (`customers:write`); a sent contract is kept and cancelled instead. */
export async function deleteDraft(member: Membership, contractId: string): Promise<ContractResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(ID, sql`
    delete from commerce.contracts where store_id = ${member.store.id}::uuid and id = ${contractId}::uuid and status = 'draft' returning id
  `);
  if (gone.length === 0) return { ok: false, problem: (await draftStatus(member.store.id, contractId)) ? "not_draft" : "not_found" };
  await audit(member.account.id, member.store.id, "contract.deleted", { contract: contractId }, { area: "customers" });
  return { ok: true, id: contractId };
}

/** A sent contract cancelled before it is signed (`customers:write`): its signers can no longer sign. */
export async function cancelContract(member: Membership, contractId: string): Promise<ContractResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const done = await typedRows(ID, sql`
    update commerce.contracts set status = 'cancelled', closed_at = now(), updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${contractId}::uuid and status = 'sent' returning id
  `);
  if (done.length === 0) return { ok: false, problem: (await draftStatus(member.store.id, contractId)) ? "not_draft" : "not_found" };
  await audit(member.account.id, member.store.id, "contract.cancelled", { contract: contractId }, { area: "customers" });
  return { ok: true, id: contractId };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Facts and sending
// ---------------------------------------------------------------------------------------------------------------------------------

const factsRow = z.object({
  deal_title: col.text,
  owner_name: col.textOrNull,
  customer_name: col.textOrNull,
  customer_email: col.textOrNull,
  customer_phone: col.textOrNull,
  customer_address: z.unknown().nullable(),
  company_name: col.textOrNull,
  company_org: col.textOrNull,
  draft_id: col.uuid.nullable(),
});

/** The locale a contract's amounts and dates are written in: the store's own market's when it speaks the contract's language, else the language. */
const localeFor = (store: Store, language: string): string =>
  store.markets.find((m) => m.lang === language)?.locale ?? (language === "nb" ? "nb-NO" : language === "en" ? "en-GB" : language);

/**
 * What a contract's fields are filled from: the deal and its owner, the deal's person and company, the store's business details, the
 * first quote linked to the deal that is still open or became an order (its lines and total worked out by `computeDraft()`, in code), and
 * today and the expiry, written in the contract's language.
 */
export async function contractFacts(store: Store, contract: Pick<Contract, "id" | "dealId" | "title" | "language">, now: Date, expiresAt: Date): Promise<ContractFacts & { parties: ContractSnapshot["parties"] }> {
  const r = await typedRow(
    factsRow,
    sql`
      select d.title as deal_title, nullif(btrim(coalesce(a.name, '')), '') as owner_name,
        nullif(btrim(c.name), '') as customer_name, c.email as customer_email, nullif(btrim(c.phone), '') as customer_phone, c.address as customer_address,
        co.name as company_name, nullif(btrim(co.organisation_number), '') as company_org,
        (select l.draft_id from commerce.deal_links l join commerce.draft_orders q on q.store_id = l.store_id and q.id = l.draft_id
          where l.store_id = d.store_id and l.deal_id = d.id and l.kind = 'draft' order by l.created_at, l.id limit 1) as draft_id
      from commerce.contracts k
      join commerce.deals d on d.store_id = k.store_id and d.id = k.deal_id
      left join commerce.accounts a on a.id = d.owner_id
      left join commerce.customers c on c.store_id = k.store_id and c.id = coalesce(k.customer_id, d.customer_id)
      left join commerce.customer_companies co on co.store_id = k.store_id and co.id = coalesce(k.company_id, d.company_id)
      where k.store_id = ${store.id}::uuid and k.id = ${contract.id}::uuid
    `,
  );
  const locale = localeFor(store, contract.language);
  const details = store.details;
  const customerAddress = r?.customer_address ? addressText(r.customer_address as Parameters<typeof addressText>[0]) || null : null;
  const storeName = details.legalName?.trim() || store.name;
  const values: Partial<Record<ContractField, string | null>> = {
    "customer.name": r?.customer_name ?? null,
    "customer.email": r?.customer_email ?? null,
    "customer.phone": r?.customer_phone ?? null,
    "customer.address": customerAddress,
    "company.name": r?.company_name ?? null,
    "company.org_number": r?.company_org ?? null,
    "company.address": null,
    "store.name": storeName,
    "store.org_number": details.organisationNumber,
    "store.address": details.postalAddress,
    "store.email": details.contactEmail,
    "deal.title": r?.deal_title ?? null,
    "deal.owner": r?.owner_name ?? null,
    "deal.value": null,
    "contract.title": contract.title,
    "contract.date": dateIn(store, now, "long", locale),
    "contract.expires": dateIn(store, expiresAt, "long", locale),
  };

  let quote: ContractFacts["quote"] = null;
  if (r?.draft_id) {
    const priced = await computeDraft(db(), store.id, r.draft_id);
    const summary = priced?.summary;
    if (summary && summary.lines.length > 0) {
      const money = (minor: number) => formatMoney(minor, summary.currency, locale);
      quote = {
        lines: summary.lines.map((line) => ({ name: line.title, quantity: line.quantity, unitPrice: money(line.unitPriceMinor), total: money(line.totalMinor) })),
        total: money(summary.totalMinor),
      };
      values["deal.value"] = quote.total;
    }
  }

  const customerSide = r?.company_name
    ? { name: r.company_name, orgNumber: r.company_org, address: null }
    : { name: r?.customer_name ?? r?.customer_email ?? "", orgNumber: null, address: customerAddress };
  return {
    values,
    quote,
    parties: { store: { name: storeName, orgNumber: details.organisationNumber, address: details.postalAddress }, customer: customerSide },
  };
}

/** Renders one HTML page to PDF bytes: `renderPdf` from `invoice-pdf.ts`, passed in by the route that sends (Chromium is loaded only by routes
 * listed in `outputFileTracingIncludes`, `document-readers.test.ts`). */
export type PdfRenderer = (html: string) => Promise<Uint8Array>;
export type SendDeps = { render: PdfRenderer; now?: Date; storage?: DocumentStorage | null };

/** The contract as it would be sent now, and what stops it (for the draft's preview, step 2). Nothing is written. */
export async function previewContract(member: Membership, contractId: string, now: Date = new Date()) {
  const contract = await getContract(member, contractId);
  if (!contract) return null;
  const expiresAt = new Date(now.getTime() + (await expiresDaysOf(member.store.id, contractId)) * DAY_MS);
  const facts = await contractFacts(member.store, contract, now, expiresAt);
  const signers: SnapshotSigner[] = contract.signers.map((g) => ({ role: g.role, name: g.name }));
  return fillContract({ title: contract.title, language: contract.language, blocks: contract.blocks, parties: facts.parties, signers }, facts);
}

const expiresDaysOf = async (storeId: string, contractId: string): Promise<number> =>
  (
    await typedRow(
      z.object({ days: col.int }),
      sql`select coalesce(t.expires_days, 30) as days from commerce.contracts k
          left join commerce.contract_templates t on t.store_id = k.store_id and t.id = k.template_id
          where k.store_id = ${storeId}::uuid and k.id = ${contractId}::uuid`,
    )
  )?.days ?? 30;

/**
 * Sends a draft (`customers:write`): fills it (a field with no value, a quote block with no quote, or a missing signer stops it, saying
 * which), draws its PDF from the snapshot, keeps the file once in the `documents` bucket and freezes snapshot, file and SHA-256 with the
 * expiry in one statement; the database moves the deal to its contract stage and cancels the version this one replaces. A PDF that cannot
 * be made or kept sends nothing. Never sent to a closed deal.
 */
export async function sendContract(member: Membership, contractId: string, deps: SendDeps): Promise<SendResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const contract = await getContract(member, contractId);
  if (!contract) return { ok: false, problem: "not_found" };
  if (contract.status !== "draft") return { ok: false, problem: "not_draft" };
  if (!contract.dealId) return { ok: false, problem: "not_found" };
  const deal = await dealOf(member.store.id, contract.dealId);
  if (!deal) return { ok: false, problem: "not_found" };
  if (deal.status !== "open") return { ok: false, problem: "deal_closed" };

  const now = deps.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (await expiresDaysOf(member.store.id, contractId)) * DAY_MS);
  const facts = await contractFacts(member.store, contract, now, expiresAt);
  const signers: SnapshotSigner[] = contract.signers.map((g) => ({ role: g.role, name: g.name }));
  const filled = fillContract({ title: contract.title, language: contract.language, blocks: contract.blocks, parties: facts.parties, signers }, facts);
  if (!filled.ok) return { ok: false, problem: "unfilled", fill: filled.problems };

  const storage = deps.storage === undefined ? documentStorage() : deps.storage;
  if (!storage) {
    log("error", "contracts.no_storage", { contractId });
    return { ok: false, problem: "pdf_failed" };
  }
  let bytes: Uint8Array;
  try {
    bytes = await deps.render(contractHtml(filled.snapshot));
    if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) throw new Error("The PDF was empty or too large.");
  } catch (error) {
    log("error", "contracts.pdf_failed", { contractId }, error);
    return { ok: false, problem: "pdf_failed" };
  }
  const path = contractPdfPath(member.store.id, contractId);
  // A file already there is from a send that stopped before the row was frozen (it is still a draft, so no signer has seen it): it is
  // removed and stored again.
  if (!(await storage.upload(path, bytes, "application/pdf"))) {
    await storage.remove([path]);
    if (!(await storage.upload(path, bytes, "application/pdf"))) return { ok: false, problem: "pdf_failed" };
  }
  const sent = await typedRows(ID, sql`
    update commerce.contracts set status = 'sent', snapshot = ${JSON.stringify(filled.snapshot)}::jsonb, pdf_path = ${path}, pdf_sha256 = ${sha256(bytes)},
      sent_at = ${now.toISOString()}::timestamptz, sent_by = ${member.account.id}::uuid, expires_at = ${expiresAt.toISOString()}::timestamptz,
      updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${contractId}::uuid and status = 'draft'
    returning id
  `);
  if (sent.length === 0) {
    // Sent by someone else meanwhile: their file is the one kept (the same path); nothing more to do.
    return { ok: false, problem: "not_draft" };
  }
  await audit(member.account.id, member.store.id, "contract.sent", { contract: contractId, deal: contract.dealId }, { area: "customers", target: { type: "deal", id: contract.dealId } });
  return { ok: true, id: contractId };
}

/** A new version of a sent, declined or expired contract (`customers:write`): a draft with its words and signers, which cancels it once sent. */
export async function newVersion(member: Membership, contractId: string): Promise<ContractResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const contract = await getContract(member, contractId);
  if (!contract) return { ok: false, problem: "not_found" };
  if (!["sent", "declined", "expired"].includes(contract.status)) return { ok: false, problem: "not_draft" };
  const id = await db().transaction(async (tx) => {
    const made = await typedRows(ID, sql`
      insert into commerce.contracts (store_id, deal_id, template_id, title, language, blocks, reminder_days, replaces_id, created_by, updated_by)
      select store_id, deal_id, template_id, title, language, blocks, reminder_days, id, ${member.account.id}::uuid, ${member.account.id}::uuid
      from commerce.contracts where store_id = ${member.store.id}::uuid and id = ${contractId}::uuid
      returning id
    `, tx);
    const next = made[0].id;
    await tx.execute(sql`
      insert into commerce.contract_signers (store_id, contract_id, role, position, name, email, account_id)
      select g.store_id, ${next}::uuid, g.role, g.position, g.name, g.email, g.account_id from commerce.contract_signers g
      where g.store_id = ${member.store.id}::uuid and g.contract_id = ${contractId}::uuid
        and (g.role <> 'store' or exists (select 1 from commerce.store_members m where m.store_id = g.store_id and m.account_id = g.account_id and m.disabled_at is null
          and (m.expires_at is null or m.expires_at > now())))
    `);
    return next;
  });
  await audit(member.account.id, member.store.id, "contract.new_version", { contract: id, replaces: contractId }, { area: "customers" });
  return { ok: true, id };
}

/** The PDF of one of the store's contracts (`customers:read`): the signed one once made, else the sent one; null when there is none. */
export async function contractPdf(member: Membership, contractId: string, storage: DocumentStorage | null = documentStorage()): Promise<Uint8Array | null> {
  if (!memberCan(member, READ) || !storage) return null;
  const row = await typedRow(
    z.object({ pdf_path: col.textOrNull, signed_pdf_path: col.textOrNull }),
    sql`select pdf_path, signed_pdf_path from commerce.contracts where store_id = ${member.store.id}::uuid and id = ${contractId}::uuid`,
  );
  // The signed PDF once it is made (D695 step 3), else the one that was sent.
  const path = row?.signed_pdf_path ?? row?.pdf_path;
  if (!path || !path.startsWith(`${member.store.id}/contracts/`)) return null;
  return storage.download(path).catch(() => null);
}
