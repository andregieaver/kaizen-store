"use client";

import { useState } from "react";

import { Button } from "@/components/admin/ui";
import { TextInput } from "@/components/admin/ui/field";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { CONTRACT_FIELDS } from "@/lib/contract-field-keys";
import type { ContractBlock } from "@/lib/contract-fields";
import { contractDocText, docFromText } from "@/lib/contract-rich";
import type { RichTextDoc } from "@/lib/rich-text-doc";

import { ContractTextEditor } from "../lazy/editors";

/**
 * A contract's or a template's words as blocks (D695), in a file of its own so a template's page does not carry the draft's editor and
 * preview (`ContractEditor`, D857): a client module's every export goes to the browser.
 */

type Words = DealsMessages["contracts"];

/** A paragraph's or a clause's words as the editor starts them: their document, or their plain text made one (a block from before formatting). */
const docOf = (block: { text: string; doc?: RichTextDoc }): RichTextDoc => block.doc ?? docFromText(block.text);

function nextClauseId(blocks: readonly ContractBlock[]): string {
  const taken = new Set(blocks.flatMap((b) => (b.type === "clause" ? [b.id] : [])));
  let n = blocks.length + 1;
  while (taken.has(`clause-${n}`)) n += 1;
  return `clause-${n}`;
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
              <TextInput
                full
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
                <TextInput
                  full
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
