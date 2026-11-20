"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";

import { Button, Card } from "@/components/admin/ui";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { fillContract, type ContractBlock, type ContractFacts, type ContractSnapshot } from "@/lib/contract-fields";

import { BlocksEditor } from "./blocks-editor";
import { ContractPaper, ContractReadiness } from "./contract-preview";

/**
 * A contract's draft (D695): its title, its words as blocks (`BlocksEditor`, rich text, D856), and who signs, and under them how it will
 * look (D857). Homer changes the words in place and sees the contract change while typing, then presses Save and Send. Lisa adds, moves and
 * removes blocks, leaves out an optional clause, and names the signers. The preview is filled in the browser (`fillContract()`) from the
 * facts the server gathered for the deal (`draftFacts()`); sending fills it again on the server from what was saved, so Send is offered only
 * with nothing left unsaved.
 */

type Words = DealsMessages["contracts"];
export type EditorSigner = { role: "store" | "customer" | "other"; name: string; email: string; accountId: string | null };
type Member = { id: string; name: string; email: string };

const inputClass = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

type Facts = ContractFacts & { parties: ContractSnapshot["parties"] };

export function ContractEditor({
  initial,
  team,
  words: w,
  save,
  language,
  facts,
  previewCss,
  send,
}: {
  initial: { title: string; blocks: ContractBlock[]; signers: EditorSigner[] };
  team: Member[];
  words: Words;
  save: (input: { title: string; blocks: ContractBlock[]; signers: EditorSigner[] }) => Promise<{ ok: boolean; messages: string[] }>;
  /** The contract's language, for the preview's own words. */
  language: string;
  /** What the words are filled in from, gathered by the server for this deal now. */
  facts: Facts;
  /** The contract's styles without the printed page's margins. */
  previewCss: string;
  /** Sending, drawn by the page: offered when the saved draft is ready; `hint` names who signs first. */
  send: { form: ReactNode; hint: string } | null;
}) {
  const [title, setTitle] = useState(initial.title);
  const [blocks, setBlocks] = useState<ContractBlock[]>(initial.blocks);
  const [signers, setSigners] = useState<EditorSigner[]>(initial.signers);
  const [answer, setAnswer] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [pending, start] = useTransition();

  const storeSigner = signers.find((s) => s.role === "store");
  const setSigner = (index: number, patch: Partial<EditorSigner>) => setSigners((all) => all.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const chooseStoreSigner = (accountId: string) => {
    const member = team.find((m) => m.id === accountId);
    if (!member) return;
    const next = { role: "store" as const, name: member.name, email: member.email, accountId: member.id };
    setSigners((all) => (all.some((s) => s.role === "store") ? all.map((s) => (s.role === "store" ? next : s)) : [next, ...all]));
  };

  // The store signs first: its signer is kept first, the customer's side after it in the order shown.
  const ordered = useMemo(() => [...signers.filter((s) => s.role === "store"), ...signers.filter((s) => s.role !== "store")], [signers]);
  const current = JSON.stringify({ title, blocks, signers: ordered });
  const [saved, setSaved] = useState(() =>
    JSON.stringify({
      title: initial.title,
      blocks: initial.blocks,
      signers: [...initial.signers.filter((s) => s.role === "store"), ...initial.signers.filter((s) => s.role !== "store")],
    }),
  );
  const unsaved = current !== saved;

  const onSave = () =>
    start(async () => {
      const result = await save({ title, blocks, signers: ordered });
      setAnswer(result);
      if (result.ok) setSaved(current);
    });

  // The contract as it would go out with the words as they are now: the server's values, with the title as typed.
  const preview = useMemo(
    () =>
      fillContract(
        { title, language, blocks, parties: facts.parties, signers: ordered.map((s) => ({ role: s.role, name: s.name })) },
        { values: { ...facts.values, "contract.title": title }, quote: facts.quote },
      ),
    [title, language, blocks, facts, ordered],
  );

  return (
    <>
      <Card title={w.words} compact>
        <div className="flex flex-col gap-6">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.titleLabel}
            <input className={inputClass} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <BlocksEditor blocks={blocks} setBlocks={setBlocks} words={w} />

          <section className="flex flex-col gap-3" aria-label={w.signers}>
            <div>
              <h3 className="text-body-strong text-ink">{w.signers}</h3>
              <p className="text-sm text-muted">{w.signersHint}</p>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.roles.store}
              <select className={inputClass} value={storeSigner?.accountId ?? ""} onChange={(e) => chooseStoreSigner(e.target.value)}>
                {!storeSigner && <option value="">—</option>}
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name === m.email ? m.email : `${m.name} (${m.email})`}
                  </option>
                ))}
              </select>
            </label>
            {signers.map((signer, index) =>
              signer.role === "store" ? null : (
                <fieldset key={index} className="flex flex-col gap-2 rounded-panel border border-line p-3">
                  <legend className="px-1 text-sm font-medium">{w.roles[signer.role]}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      {w.name}
                      <input
                        className={inputClass}
                        value={signer.name}
                        maxLength={200}
                        autoComplete="off"
                        onChange={(e) => setSigner(index, { name: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      {w.email}
                      <input
                        className={inputClass}
                        type="email"
                        value={signer.email}
                        autoComplete="off"
                        onChange={(e) => setSigner(index, { email: e.target.value })}
                      />
                    </label>
                  </div>
                  {signer.role === "other" && (
                    <div>
                      <Button kind="quiet" size="dense" onClick={() => setSigners((all) => all.filter((_, i) => i !== index))}>
                        {w.remove}
                      </Button>
                    </div>
                  )}
                </fieldset>
              ),
            )}
            <div>
              <Button
                onClick={() =>
                  setSigners((all) => [
                    ...all,
                    { role: all.some((s) => s.role === "customer") ? "other" : "customer", name: "", email: "", accountId: null },
                  ])
                }
              >
                {w.addSigner}
              </Button>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button kind="main" onClick={onSave} disabled={pending}>
              {w.save}
            </Button>
            <p role="status" aria-live="polite" className={answer && !answer.ok ? "text-sm text-danger" : "text-sm text-muted"}>
              {unsaved ? null : answer?.messages.join(" ")}
            </p>
          </div>
        </div>
      </Card>

      <Card title={w.preview} compact>
        <ContractReadiness ok={preview.ok} problems={preview.ok ? [] : preview.problems} words={w} live />
        {send && (
          <div className="mb-4 flex flex-col gap-2">
            <p className="text-sm text-muted">{!preview.ok ? w.sendBlocked : unsaved ? w.saveFirst : send.hint}</p>
            {preview.ok && !unsaved && send.form}
          </div>
        )}
        <ContractPaper snapshot={preview.snapshot} css={previewCss} />
      </Card>
    </>
  );
}
