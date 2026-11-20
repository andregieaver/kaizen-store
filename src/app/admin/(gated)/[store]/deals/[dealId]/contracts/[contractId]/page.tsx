import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ContractEditor, type EditorSigner } from "@/components/admin/deals/contract-editor";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireFeature } from "@/components/admin/feature-off";
import { AdminLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { CONTRACT_CSS } from "@/components/documents/contract-document-view";
import { ContractPaper, ContractReadiness } from "@/components/admin/deals/contract-preview";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { DEALS_WORDS } from "@/lib/admin-words/deals";
import { contractVersions } from "@/lib/contract-versions";
import { contractsOfDeal, draftFacts, getContract, previewContract, type ContractStatus } from "@/server/contracts";
import { getDeal } from "@/server/deals";
import { memberCan, requirePermission } from "@/server/permissions";
import { listStaff } from "@/server/settings";

import {
  cancelContractAction,
  deleteContractAction,
  newVersionAction,
  saveAsTemplateAction,
  saveContractAction,
  signForStoreAction,
} from "../../../contract-actions";
import { sendContractAction } from "../../../contract-send-actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Contract" };

/** The preview on the admin's page: the contract's own styles without the printed page's margins. */
const PREVIEW_CSS = CONTRACT_CSS.replace(/@page\s*\{[^}]*\}/, "");

const signal = (status: ContractStatus) =>
  status === "signed" ? "positive" : status === "declined" || status === "expired" || status === "cancelled" ? "danger" : "neutral";

/**
 * One contract on a deal (D695). A draft: its words and signers to change (`ContractEditor`), and beside them (or under them, D862), how it
 * will look, filled in as the words are typed (D857) with what still stops it from going out. A sent one: the document as it was sent,
 * each signer's step, its PDF, and a new version or a cancel. Every contract says its version, and with more than one its versions are
 * listed, each with how it ended and why a signer declined.
 */
export default async function ContractPage({ params }: PageProps<"/admin/[store]/deals/[dealId]/contracts/[contractId]">) {
  const { store: slug, dealId, contractId } = await params;
  const member = await requirePermission(slug, "customers:read");
  const notInAccount = requireExtension(member, "deals");
  if (notInAccount) return notInAccount;
  const off = requireFeature(member, "sales");
  if (off) return off;
  if (!z.uuid().safeParse(dealId).success || !z.uuid().safeParse(contractId).success) notFound();
  const { store } = member;
  const [deal, contract] = await Promise.all([getDeal(store, dealId), getContract(member, contractId)]);
  if (!deal || !contract || contract.dealId !== deal.id) notFound();

  const lang = adminLangOf(member.account.adminLocale);
  const w = DEALS_WORDS[lang].contracts;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: store.timeZone });
  const canChange = memberCan(member, "customers:write");
  const base = `/admin/${store.slug}`;
  const draft = contract.status === "draft";
  const editing = draft && canChange;

  const [preview, facts, staff, ofDeal] = await Promise.all([
    draft && !editing ? previewContract(member, contract.id) : Promise.resolve(null),
    editing ? draftFacts(member, contract) : Promise.resolve(null),
    editing ? listStaff(store.id) : Promise.resolve([]),
    contractsOfDeal(member, deal.id),
  ]);
  const versions = contractVersions(ofDeal);
  const mine = versions.get(contract.id);
  const chain = mine?.chain ?? [];
  const now = new Date().toISOString();
  const team = staff
    .filter((s) => !s.disabled && (!s.expiresAt || s.expiresAt > now))
    .map((s) => ({ id: s.accountId, name: s.name || s.email, email: s.email }));
  const shown = draft ? (preview?.snapshot ?? null) : contract.snapshot;
  const storeSigner = contract.signers.find((s) => s.role === "store") ?? null;
  // Whose turn it is on a sent contract: the first signer who has not signed.
  const next = contract.status === "sent" ? (contract.signers.find((s) => !s.signedAt && !s.declinedAt) ?? null) : null;
  const myTurn = canChange && next?.role === "store" && next.accountId === member.account.id;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/deals/${deal.id}`, label: w.back }}
        title={contract.title}
        status={<Chip signal={signal(contract.status)}>{w.statuses[contract.status]}</Chip>}
        meta={[
          fillWords(w.version, { n: mine?.number ?? 1 }),
          deal.title === contract.title ? null : deal.title,
          contract.sentAt ? fillWords(w.sentOn, { date: when(contract.sentAt) }) : null,
          contract.status === "sent" && contract.expiresAt ? fillWords(w.until, { date: when(contract.expiresAt) }) : null,
          contract.completedAt ? fillWords(w.signedOn, { date: when(contract.completedAt) }) : null,
        ].filter(Boolean)}
      />

      {editing && facts && (
        <ContractEditor
          initial={{
            title: contract.title,
            blocks: contract.blocks,
            signers: contract.signers.map((s): EditorSigner => ({ role: s.role, name: s.name, email: s.email, accountId: s.accountId })),
          }}
          team={team}
          words={w}
          save={saveContractAction.bind(null, store.slug, contract.id)}
          saveAsTemplate={saveAsTemplateAction.bind(null, store.slug, contract.id)}
          language={contract.language}
          facts={facts}
          previewCss={PREVIEW_CSS}
          send={{
            hint: storeSigner && storeSigner.accountId !== member.account.id ? fillWords(w.sendOther, { name: storeSigner.name }) : w.sendHint,
            form: (
              <ActionForm action={sendContractAction.bind(null, store.slug, contract.id)}>
                <SubmitButton>{w.send}</SubmitButton>
              </ActionForm>
            ),
          }}
        />
      )}

      {!editing && (
        <Card title={draft ? w.preview : w.title} compact>
          {preview && <ContractReadiness ok={preview.ok} problems={preview.ok ? [] : preview.problems} words={w} />}
          {shown && <ContractPaper snapshot={shown} css={PREVIEW_CSS} />}
        </Card>
      )}

      {myTurn && next && (
        <Card title={w.signTitle} compact>
          <p className="mb-3 text-sm text-muted">{w.signHint}</p>
          <ActionForm action={signForStoreAction.bind(null, store.slug, contract.id)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.signName}
              <input name="name" defaultValue={next.name} required maxLength={200} autoComplete="name" className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal" />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="agree" required className="mt-1" />
              {w.signAgree}
            </label>
            <div>
              <SubmitButton>{w.sign}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      {!draft && (
        <Card title={w.signers} compact>
          {next && !myTurn && <p className="mb-3 text-sm text-ink">{fillWords(w.waitingFor, { name: next.name })}</p>}
          {contract.status === "signed" && !contract.signedPdf && <p className="mb-3 text-sm text-ink">{w.signedPdfComing}</p>}
          <ul className="flex flex-col gap-2 text-sm">
            {contract.signers.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  <span className="text-muted">{w.roles[s.role]} </span>
                  <span className="font-medium text-ink">{s.name}</span> <span className="text-ink-2">{s.email}</span>
                </span>
                <span className="text-ink-2">
                  {s.signedAt
                    ? fillWords(w.signerStatus.signed, { date: when(s.signedAt) })
                    : s.declinedAt
                      ? w.signerStatus.declined
                      : s.viewedAt
                        ? w.signerStatus.viewed
                        : w.signerStatus.waiting}
                </span>
                {s.declineReason && <span className="basis-full text-ink-2">{fillWords(w.declinedBy, { name: s.name, reason: s.declineReason })}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <a className="text-sm font-medium underline" href={`${base}/deals/${deal.id}/contracts/${contract.id}/pdf`}>
              {w.pdf}
            </a>
          </div>
          {canChange && (
            <div className="mt-4 flex flex-wrap gap-3">
              {["sent", "declined", "expired"].includes(contract.status) && (
                <ActionForm action={newVersionAction.bind(null, store.slug, deal.id, contract.id)}>
                  <SubmitButton variant="secondary">{w.newVersion}</SubmitButton>
                </ActionForm>
              )}
              {contract.status === "sent" && (
                <ActionForm action={cancelContractAction.bind(null, store.slug, contract.id)}>
                  <SubmitButton variant="secondary">{w.cancel}</SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      )}

      {chain.length > 1 && (
        <Card title={w.versions} description={w.versionsHint} compact>
          <ol className="flex flex-col gap-3 text-sm">
            {chain.map((v, i) => {
              const declined = v.signers.find((g) => g.declinedAt);
              return (
                <li key={v.id} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    {v.id === contract.id ? (
                      <span className="font-medium text-ink" aria-current="page">
                        {fillWords(w.version, { n: i + 1 })}
                      </span>
                    ) : (
                      <AdminLink className="font-medium underline" href={`${base}/deals/${deal.id}/contracts/${v.id}`}>
                        {fillWords(w.version, { n: i + 1 })}
                      </AdminLink>
                    )}
                    <Chip signal={signal(v.status)}>{w.statuses[v.status]}</Chip>
                    <span className="text-muted">{v.sentAt ? fillWords(w.sentOn, { date: when(v.sentAt) }) : null}</span>
                  </span>
                  {declined && (
                    <span className="text-ink-2">
                      {declined.declineReason
                        ? fillWords(w.declinedBy, { name: declined.name, reason: declined.declineReason })
                        : fillWords(w.declinedByNoReason, { name: declined.name })}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {editing && <DeleteDiscountButton action={deleteContractAction.bind(null, store.slug, deal.id, contract.id)} code="" question={w.removeConfirm} label={w.remove_draft} />}
    </div>
  );
}
