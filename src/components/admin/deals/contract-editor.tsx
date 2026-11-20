"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";

import { Button, Card } from "@/components/admin/ui";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import {
  CONTRACT_FIELDS,
  fillContract,
  type ContractBlock,
  type ContractFacts,
  type ContractSnapshot,
} from "@/lib/contract-fields";
import { contractDocText, docFromText } from "@/lib/contract-rich";
import type { RichTextDoc } from "@/lib/rich-text-doc";

import { ContractTextEditor } from "../lazy/editors";
import { ContractPaper, ContractReadiness } from "./contract-preview";

/**
 * A contract's draft (D695): its title, its words as blocks, and who signs, and under them how it will look (D857). Homer changes the words
 * in place and sees the contract change as he types; he presses Save, then Send. Lisa adds, moves and removes blocks, leaves out an optional
 * clause, and names the signers. The preview is filled in the browser (`fillContract()`) from the facts the server gathered for the deal
 * (`draftFacts()`); sending fills it again on the server from what was saved, so Send is offered only with nothing left unsaved. A paragraph's and a clause's words are rich text (`ContractTextEditor`: lists, bold,
 * italic, underline), kept as `doc` beside their plain `text`; a field is written in braces (`{customer.name}`).
 */

type Words = DealsMessages["contracts"];
export type EditorSigner = { role: "store" | "customer" | "other"; name: string; email: string; accountId: string | null };
type Member = { id: string; name: string; email: string };

const inputClass = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/** A paragraph's or a clause's words as the editor starts them: their document, or their plain text made one (a block from before formatting). */
const docOf = (block: { text: string; doc?: RichTextDoc }): RichTextDoc => block.doc ?? docFromText(block.text);

function nextClauseId(blocks: readonly ContractBlock[]): string {
  const taken = new Set(blocks.flatMap((b) => (b.type === "clause" ? [b.id] : [])));
  let n = blocks.length + 1;
  while (taken.has(`clause-${n}`)) n += 1;
  return `clause-${n}`;
}

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

/** A contract's or a template's words as blocks (D695): changed in place, added, moved, removed, an optional clause left out. */
export function BlocksEditor({
  blocks,
  setBlocks,
  words: w,
}: {
  blocks: ContractBlock[];
  setBlocks: (update: (all: ContractBlock[]) => ContractBlock[]) => void;
  words: Words;
}) {
  // Each block keeps its key as it moves: a rich text editor starts from its block's words once, so a moved block must keep its editor.
  const [keys, setKeys] = useState<number[]>(() => blocks.map((_, i) => i));
  const fresh = () => Math.max(-1, ...keys) + 1;
  const keyAt = (index: number) => (keys.length === blocks.length ? keys[index] : `at-${index}`);

  const change = (index: number, block: ContractBlock) => setBlocks((all) => all.map((b, i) => (i === index ? block : b)));
  const changeWords = (index: number, doc: RichTextDoc) =>
    setBlocks((all) =>
      all.map((b, i) => (i === index && (b.type === "paragraph" || b.type === "clause") ? { ...b, doc, text: contractDocText(doc) } : b)),
    );
  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    const order = [...keys];
    [order[index], order[to]] = [order[to], order[index]];
    setKeys(order);
    setBlocks((all) => {
      const copy = [...all];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  };
  const remove = (index: number) => {
    setKeys(keys.filter((_, i) => i !== index));
    setBlocks((all) => all.filter((_, i) => i !== index));
  };
  const insertAt = (all: readonly ContractBlock[]) => {
    // New words go before the signatures, where a contract's text ends.
    const at = all.findIndex((b) => b.type === "signatures");
    return at < 0 ? all.length : at;
  };
  const add = (block: ContractBlock) => {
    const at = insertAt(blocks);
    setKeys([...keys.slice(0, at), fresh(), ...keys.slice(at)]);
    setBlocks((all) => [...all.slice(0, at), block, ...all.slice(at)]);
  };

  return (
    <section className="flex flex-col gap-3" aria-label={w.words}>
      <div>
        <h3 className="text-body-strong text-ink">{w.words}</h3>
        <p className="text-sm text-muted">{w.wordsHint}</p>
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer text-ink-2">{w.fieldsList}</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {CONTRACT_FIELDS.map((key) => (
              <li key={key}>
                <code className="rounded bg-sunken px-1">{`{${key}}`}</code> <span className="text-muted">{w.fields[key]}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <ol className="flex flex-col gap-3">
        {blocks.map((block, index) => (
          <li key={keyAt(index)} className="rounded-panel border border-line bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-eyebrow text-muted">{w.kinds[block.type]}</span>
              <span className="flex gap-1">
                <Button kind="quiet" size="dense" onClick={() => move(index, -1)} disabled={index === 0} aria-label={w.up}>
                  ↑
                </Button>
                <Button kind="quiet" size="dense" onClick={() => move(index, 1)} disabled={index === blocks.length - 1} aria-label={w.down}>
                  ↓
                </Button>
                <Button kind="quiet" size="dense" onClick={() => remove(index)}>
                  {w.remove}
                </Button>
              </span>
            </div>
            {block.type === "heading" && (
              <input
                className={inputClass}
                aria-label={w.kinds.heading}
                value={block.text}
                maxLength={200}
                onChange={(e) => change(index, { ...block, text: e.target.value })}
              />
            )}
            {block.type === "paragraph" && (
              <ContractTextEditor
                value={docOf(block)}
                label={w.kinds.paragraph}
                words={w}
                fields={CONTRACT_FIELDS}
                onChange={(doc) => changeWords(index, doc)}
              />
            )}
            {block.type === "clause" && (
              <div className="flex flex-col gap-2">
                <input
                  className={inputClass}
                  aria-label={w.clauseTitle}
                  value={block.title}
                  maxLength={200}
                  onChange={(e) => change(index, { ...block, title: e.target.value })}
                />
                <ContractTextEditor
                  value={docOf(block)}
                  label={w.kinds.clause}
                  words={w}
                  fields={CONTRACT_FIELDS}
                  onChange={(doc) => changeWords(index, doc)}
                />
                <div className="flex flex-wrap gap-4 text-sm">
                  {block.optional && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={block.included} onChange={(e) => change(index, { ...block, included: e.target.checked })} />
                      {w.included}
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-muted">
                    <input
                      type="checkbox"
                      checked={block.optional}
                      onChange={(e) => change(index, { ...block, optional: e.target.checked, included: true })}
                    />
                    {w.optional}
                  </label>
                </div>
              </div>
            )}
            {block.type === "quote_lines" && <p className="text-sm text-muted">{w.quoteLinesNote}</p>}
            {block.type === "signatures" && <p className="text-sm text-muted">{w.signaturesNote}</p>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => add({ type: "paragraph", text: "" })}>{w.addText}</Button>
        <Button onClick={() => add({ type: "clause", id: nextClauseId(blocks), title: "", text: "", optional: false, included: true })}>
          {w.addClause}
        </Button>
        {!blocks.some((b) => b.type === "signatures") && (
          <Button
            onClick={() => {
              setKeys([...keys, fresh()]);
              setBlocks((all) => [...all, { type: "signatures" }]);
            }}
          >
            {w.kinds.signatures}
          </Button>
        )}
      </div>
    </section>
  );
}
