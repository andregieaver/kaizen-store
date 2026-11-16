import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ContractEditor, type EditorSigner } from "@/components/admin/deals/contract-editor";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { CONTRACT_CSS, ContractDocumentView } from "@/components/documents/contract-document-view";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { FillProblem } from "@/lib/contract-fields";
import { getContract, previewContract, type ContractStatus } from "@/server/contracts";
import { getDeal } from "@/server/deals";
import { memberCan, requirePermission } from "@/server/permissions";
import { listStaff } from "@/server/settings";

import { cancelContractAction, deleteContractAction, newVersionAction, saveContractAction } from "../../../contract-actions";

export const metadata: Metadata = { title: "Contract" };

/** The preview on the admin's page: the contract's own styles without the printed page's margins. */
const PREVIEW_CSS = CONTRACT_CSS.replace(/@page\s*\{[^}]*\}/, "");

const signal = (status: ContractStatus) =>
  status === "signed" ? "positive" : status === "declined" || status === "expired" || status === "cancelled" ? "danger" : "neutral";

/**
 * One contract on a deal (D695). A draft: its words and signers to change (`ContractEditor`), and beside them how it will look, filled in
 * from the deal now, with what still stops it from going out (kept in view while the words are edited on a wide screen). A sent one: the
 * document as it was sent, each signer's step, its PDF, and a new version or a cancel.
 */
export default async function ContractPage({ params }: PageProps<"/admin/[store]/deals/[dealId]/contracts/[contractId]">) {
  const { store: slug, dealId, contractId } = await params;
  const member = await requirePermission(slug, "customers:read");
  const off = requireFeature(member, "sales");
  if (off) return off;
  if (!z.uuid().safeParse(dealId).success || !z.uuid().safeParse(contractId).success) notFound();
  const { store } = member;
  const [deal, contract] = await Promise.all([getDeal(store, dealId), getContract(member, contractId)]);
  if (!deal || !contract || contract.dealId !== deal.id) notFound();

  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "deals").contracts;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: store.timeZone });
  const canChange = memberCan(member, "customers:write");
  const base = `/admin/${store.slug}`;
  const draft = contract.status === "draft";
  const editing = draft && canChange;

  const [preview, staff] = await Promise.all([
    draft ? previewContract(member, contract.id) : Promise.resolve(null),
    editing ? listStaff(store.id) : Promise.resolve([]),
  ]);
  const now = new Date().toISOString();
  const team = staff
    .filter((s) => !s.disabled && (!s.expiresAt || s.expiresAt > now))
    .map((s) => ({ id: s.accountId, name: s.name || s.email, email: s.email }));
  const shown = draft ? (preview?.snapshot ?? null) : contract.snapshot;
  const fillText = (problem: FillProblem) =>
    problem.kind === "missing_field" ? fillWords(w.fill.missing_field, { field: `{${problem.key}} (${w.fields[problem.key]})` }) : w.fill[problem.kind];

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/deals/${deal.id}`, label: w.back }}
        title={contract.title}
        status={<Chip signal={signal(contract.status)}>{w.statuses[contract.status]}</Chip>}
        meta={[
          deal.title === contract.title ? null : deal.title,
          contract.sentAt ? fillWords(w.sentOn, { date: when(contract.sentAt) }) : null,
          contract.status === "sent" && contract.expiresAt ? fillWords(w.until, { date: when(contract.expiresAt) }) : null,
          contract.completedAt ? fillWords(w.signedOn, { date: when(contract.completedAt) }) : null,
        ].filter(Boolean)}
      />

      <div className={editing ? "grid gap-6 lg:grid-cols-2" : "flex flex-col gap-6"}>
        {editing && (
          <Card title={w.words} compact>
            <ContractEditor
              initial={{
                title: contract.title,
                blocks: contract.blocks,
                signers: contract.signers.map((s): EditorSigner => ({ role: s.role, name: s.name, email: s.email, accountId: s.accountId })),
              }}
              team={team}
              words={w}
              save={saveContractAction.bind(null, store.slug, contract.id)}
            />
          </Card>
        )}

        <div className={editing ? "lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto" : undefined}>
          <Card title={draft ? w.preview : w.title} compact>
            {preview && (
              <div className="mb-4 rounded-panel bg-sunken p-3 text-sm">
                {preview.ok ? (
                  <p className="text-ink">{w.ready}</p>
                ) : (
                  <>
                    <p className="font-medium text-ink">{w.notReady}</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-2">
                      {preview.problems.map((p, i) => (
                        <li key={i}>{fillText(p)}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="mt-2 text-muted">{w.sendSoon}</p>
              </div>
            )}
            {shown && (
              <div className="rounded-panel border border-line bg-white p-6 text-black">
                <style>{PREVIEW_CSS}</style>
                <ContractDocumentView snapshot={shown} />
              </div>
            )}
          </Card>
        </div>
      </div>

      {!draft && (
        <Card title={w.signers} compact>
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

      {editing && <DeleteDiscountButton action={deleteContractAction.bind(null, store.slug, deal.id, contract.id)} code="" question={w.removeConfirm} label={w.remove_draft} />}
    </div>
  );
}
