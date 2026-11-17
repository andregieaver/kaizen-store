import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { remindSummary, type DraftContractInput, type ListContractsInput, type RemindContractSignerInput } from "@/lib/contract-tools";
import type { FillProblem } from "@/lib/contract-fields";

import { passMembership, type Account, type Membership } from "./auth";
import { notifyNext } from "./contract-signing";
import { createContract, ensureTemplate, getContract, listTemplates, previewContract, type ContractProblem } from "./contracts";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The AI manager's contract tools (D695 step 4, `docs/contracts.md` 7): `list_contracts` reads the store's contracts and templates as the
 * deal's Contracts card shows them; `draft_contract` makes a draft on a deal from a template through `createContract()`, as the card's
 * button does, and says what still stops it being sent; `remind_contract_signer` emails the signer whose turn it is a reminder through
 * `notifyNext()`, as the reminder job does (`send`, the owner's yes first). Sending is the contract's page's alone: it draws the PDF there.
 * A signer's email, a reason a signer gave for declining and the contract's words are never read here: they are on the contract's page.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const LIST_MAX = 25;
/** A reminder by the manager waits this long after the signer was last asked, so a signer is never emailed twice in a day. */
const REMIND_GAP_MS = 24 * 60 * 60 * 1000;

const contractPage = (store: Store, dealId: string | null, contractId: string) =>
  dealId ? `/admin/${store.slug}/deals/${dealId}/contracts/${contractId}` : `/admin/${store.slug}/deals`;

async function member(ctx: Ctx): Promise<Membership> {
  const found = await passMembership(ctx.store.slug, ctx.account.id);
  return found ?? fail("You are not a member of this store any more.");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const DEAL_ROW = z.object({ id: col.uuid, title: col.text, status: z.enum(["open", "won", "lost"]) });

/** The deal a call names: its id, its whole title, or the one deal whose title holds the words. */
async function findDeal(store: Store, ref: string) {
  const text = ref.trim();
  const rows = await typedRows(
    DEAL_ROW,
    UUID.test(text)
      ? sql`select id, title, status from commerce.deals where store_id = ${store.id}::uuid and id = ${text}::uuid`
      : sql`select id, title, status from commerce.deals where store_id = ${store.id}::uuid and title ilike ${likeOf(text)}
            order by (lower(title) = lower(${text})) desc, (status = 'open') desc, updated_at desc limit 6`,
  );
  if (rows.length === 0) return fail(`No deal "${text}" in this store. The Deals board lists them: /admin/${store.slug}/deals.`);
  const exact = rows.filter((r) => r.title.toLowerCase() === text.toLowerCase() || r.id === text.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length > 1) return fail(`Several deals have "${text}" in their title: ${rows.map((r) => `"${r.title}" (${r.status})`).join(", ")}. Name one by its whole title.`);
  return rows[0];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------------------

const LIST_ROW = z.object({
  id: col.uuid,
  deal_id: col.uuid.nullable(),
  deal_title: col.textOrNull,
  title: col.text,
  language: col.text,
  status: z.enum(["draft", "sent", "signed", "declined", "expired", "cancelled"]),
  sent_at: col.timestampOrNull,
  expires_at: col.timestampOrNull,
  completed_at: col.timestampOrNull,
  signed_pdf: col.bool,
});
const SIGNER_ROW = z.object({
  contract_id: col.uuid,
  role: z.enum(["store", "customer", "other"]),
  name: col.text,
  viewed_at: col.timestampOrNull,
  signed_at: col.timestampOrNull,
  declined_at: col.timestampOrNull,
  notified_at: col.timestampOrNull,
  reminders: col.int,
});

const STATUS_WORDS: Record<z.output<typeof LIST_ROW>["status"], string> = {
  draft: "a draft: nothing sent yet",
  sent: "out for signing",
  signed: "signed by everyone",
  declined: "declined by a signer",
  expired: "not signed in time",
  cancelled: "cancelled",
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

function signerState(g: z.output<typeof SIGNER_ROW>, turn: boolean): string {
  if (g.signed_at) return `signed ${day(g.signed_at)}`;
  if (g.declined_at) return `declined ${day(g.declined_at)} (the reason is on the contract's page)`;
  if (!turn) return "waits for the signers before";
  const asked = g.notified_at ? `asked ${day(g.notified_at)}${g.reminders > 0 ? `, reminded ${g.reminders} time${g.reminders === 1 ? "" : "s"}` : ""}` : "not asked yet";
  return `their turn: ${asked}${g.viewed_at ? `, opened it ${day(g.viewed_at)}` : ", not opened yet"}`;
}

export async function listContractsTool(ctx: Ctx, input: ListContractsInput) {
  const { store } = ctx;
  const deal = input.deal ? await findDeal(store, input.deal) : null;
  const status =
    input.status === "all" ? sql`true` : input.status === "open" ? sql`k.status in ('draft', 'sent')` : sql`k.status = ${input.status}`;
  const rows = await typedRows(
    LIST_ROW,
    sql`
      select k.id, k.deal_id, d.title as deal_title, k.title, k.language, k.status, k.sent_at, k.expires_at, k.completed_at,
        k.signed_pdf_path is not null as signed_pdf
      from commerce.contracts k left join commerce.deals d on d.store_id = k.store_id and d.id = k.deal_id
      where k.store_id = ${store.id}::uuid and ${status} ${deal ? sql`and k.deal_id = ${deal.id}::uuid` : sql``}
      order by k.updated_at desc, k.id limit ${LIST_MAX + 1}
    `,
  );
  const shown = rows.slice(0, LIST_MAX);
  const signers =
    shown.length === 0
      ? []
      : await typedRows(
          SIGNER_ROW,
          sql`select contract_id, role, name, viewed_at, signed_at, declined_at, notified_at, reminders from commerce.contract_signers
              where store_id = ${store.id}::uuid and contract_id in (${sql.join(shown.map((r) => sql`${r.id}::uuid`), sql`, `)}) order by position`,
        );
  // Read only: a store with no template yet gets its first when a contract is drafted (`ensureTemplate()`).
  const templates = await listTemplates(store.id);
  return {
    ...(deal ? { deal: { id: deal.id, title: deal.title, status: deal.status } } : {}),
    contracts: shown.map((r) => {
      const own = signers.filter((g) => g.contract_id === r.id);
      const turn = r.status === "sent" ? own.findIndex((g) => !g.signed_at && !g.declined_at) : -1;
      return {
        id: r.id,
        title: r.title,
        deal: r.deal_title,
        language: r.language,
        status: `${r.status}: ${STATUS_WORDS[r.status]}`,
        ...(r.sent_at ? { sent: day(r.sent_at) } : {}),
        ...(r.status === "sent" && r.expires_at ? { sign_by: day(r.expires_at) } : {}),
        ...(r.completed_at ? { ended: day(r.completed_at) } : {}),
        ...(r.status === "signed" ? { signed_pdf: r.signed_pdf ? "made: download it on the contract's page" : "being made, within minutes" } : {}),
        signers: own.map((g, i) => ({ role: g.role, name: g.name, state: r.status === "draft" ? "not sent yet" : signerState(g, i === turn) })),
        page: contractPage(store, r.deal_id, r.id),
      };
    }),
    ...(rows.length > LIST_MAX ? { more: `Only the ${LIST_MAX} changed last are listed: name a deal or a status for the others.` } : {}),
    templates: templates.map((t) => ({ name: t.name, language: t.language, days_to_sign: t.expiresDays })),
    templates_page: `/admin/${store.slug}/deals/contract-templates`,
    note: "A contract is drafted with draft_contract; it is read and sent for signing on its page (Send for signing), never by you. A signer whose turn it is can be reminded with remind_contract_signer (the owner's yes first).",
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A draft
// ---------------------------------------------------------------------------------------------------------------------------------

const PROBLEM_WORDS: Partial<Record<ContractProblem, string>> = {
  forbidden: "Your role may not change deals' contracts (it needs Customers: change).",
  not_found: "The deal or the template is not in this store any more.",
  signers: "The store has no one to sign for it: the deal has no active owner and your account has no email.",
};

function fillWords(problem: FillProblem): string {
  switch (problem.kind) {
    case "missing_field":
      return `{${problem.key}} has no value: add it to the deal's person or company, or take it out of the contract's words.`;
    case "no_signatures":
      return "The contract has no signatures block.";
    case "empty":
      return "The contract has no words.";
    case "no_store_signer":
      return "No one signs for the store.";
    case "no_customer_signer":
      return "No one signs for the customer: the deal's person has no email. Add a signer on the contract's page.";
  }
}

export async function draftContractTool(ctx: Ctx, input: DraftContractInput) {
  const { store } = ctx;
  const deal = await findDeal(store, input.deal);
  if (deal.status !== "open") return fail(`The deal "${deal.title}" is ${deal.status}: a contract is drafted only on an open deal.`);
  const templates = await ensureTemplate(store, ctx.account.id);
  const template = input.template ? templates.find((t) => t.name.toLowerCase() === input.template!.toLowerCase()) : templates[0];
  if (!template) return fail(`No template "${input.template}". The store's templates: ${templates.map((t) => `"${t.name}"`).join(", ")}.`);
  const who = await member(ctx);
  const made = await createContract(who, deal.id, template.id);
  if (!made.ok) return fail(PROBLEM_WORDS[made.problem] ?? "The contract could not be drafted. Draft it on the deal's page.");
  const [contract, preview] = await Promise.all([getContract(who, made.id), previewContract(who, made.id)]);
  const problems = preview && !preview.ok ? preview.problems.map(fillWords) : [];
  return {
    done: `A draft of "${template.name}" is made on the deal "${deal.title}". Nothing has been sent.`,
    contract: {
      id: made.id,
      title: contract?.title ?? deal.title,
      signers: (contract?.signers ?? []).map((g) => ({ role: g.role, name: g.name })),
      page: contractPage(store, deal.id, made.id),
    },
    ...(problems.length > 0 ? { stops_sending: problems } : { ready: "Every field is filled and both sides have a signer." }),
    next: "The owner reads it on its page, changes what they like and presses Send for signing there. You cannot send it.",
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A reminder
// ---------------------------------------------------------------------------------------------------------------------------------

const TURN_ROW = z.object({
  title: col.text,
  status: col.text,
  deal_id: col.uuid.nullable(),
  signer_id: col.uuid.nullable(),
  role: z.enum(["store", "customer", "other"]).nullable(),
  name: col.textOrNull,
  notified_at: col.timestampOrNull,
});

const turnOf = (store: Store, contractId: string) =>
  typedRow(
    TURN_ROW,
    sql`
      select k.title, k.status, k.deal_id, g.id as signer_id, g.role, g.name, g.notified_at
      from commerce.contracts k
      left join lateral (
        select id, role, name, notified_at from commerce.contract_signers
        where store_id = k.store_id and contract_id = k.id and signed_at is null and declined_at is null order by position limit 1
      ) g on true
      where k.store_id = ${store.id}::uuid and k.id = ${contractId}::uuid
    `,
  );

/** Checked before the owner is asked: a contract out for signing, a signer whose turn it is, not asked in the last day. */
export async function preflightRemindSigner(ctx: Ctx, input: RemindContractSignerInput, now: Date = new Date()) {
  const id = input.contract.trim();
  if (!UUID.test(id)) return fail(`"${id}" is not a contract's id: list_contracts gives them.`);
  const turn = await turnOf(ctx.store, id);
  if (!turn) return fail(`No contract ${id} in this store.`);
  if (turn.status !== "sent") return fail(`"${turn.title}" is not out for signing (it is ${turn.status}): only a contract that is is reminded.`);
  if (!turn.signer_id || !turn.role || !turn.name) return fail(`"${turn.title}" waits for no signer.`);
  if (turn.notified_at && now.getTime() - new Date(turn.notified_at).getTime() < REMIND_GAP_MS) {
    return fail(`${turn.name} was asked on ${day(turn.notified_at)}: a signer is reminded at most once a day, and the store reminds them by itself every few days.`);
  }
  return { id, title: turn.title, signer: turn.name, role: turn.role, dealId: turn.deal_id };
}

/** The approval card's words, from the contract as it is. */
export async function remindApprovalWords(ctx: Ctx, args: Record<string, unknown>): Promise<string> {
  const id = String(args.contract ?? "").trim();
  const turn = UUID.test(id) ? await turnOf(ctx.store, id) : null;
  return remindSummary(turn?.name && turn.role ? { title: turn.title, signer: turn.name, role: turn.role } : null, args);
}

export async function remindContractSignerTool(ctx: Ctx, input: RemindContractSignerInput) {
  const found = await preflightRemindSigner(ctx, input);
  const who = await member(ctx);
  if (!(await getContract(who, found.id))) return fail("Your role may not see deals' contracts (it needs Customers: read).");
  await notifyNext(ctx.store.id, found.id, { reminder: true });
  const after = await turnOf(ctx.store, found.id);
  const sent = Boolean(after?.notified_at && Date.now() - new Date(after.notified_at).getTime() < 60_000);
  if (!sent) return fail(`The reminder to ${found.signer} could not be sent now. The store tries again by itself; the contract's page says when they were asked.`);
  return {
    done:
      found.role === "store"
        ? `${found.signer} is emailed that it is their turn to sign "${found.title}" in the admin.`
        : `${found.signer} is emailed a reminder to sign "${found.title}", with their link.`,
    page: contractPage(ctx.store, found.dealId, found.id),
  };
}
