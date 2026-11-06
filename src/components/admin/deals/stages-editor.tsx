"use client";

import { useId, useState } from "react";

import { Button } from "@/components/admin/ui";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";

type Row = { key: string; id: string | null; name: string; probability: string; quoteStage: boolean };
export type StageRow = { id: string | null; name: string; probability: number | null; quoteStage: boolean };

const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

/**
 * A pipeline's stages as Lisa sets them (S2, D464): each with a name, the chance a deal in it is won (or none) and whether sent quotes go
 * there, in order (up and down), added and removed. Goes with its form as `stages`, JSON the action checks again.
 */
export function StagesEditor({ initial, words }: { initial: StageRow[]; words: DealsMessages["pipelinesPage"] }) {
  const group = useId();
  let next = 0;
  const keyOf = () => `${group}-${next++}`;
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((s) => ({ key: s.id ?? keyOf(), id: s.id, name: s.name, probability: s.probability === null ? "" : String(s.probability), quoteStage: s.quoteStage })),
  );
  const [added, setAdded] = useState(0);
  const set = (index: number, patch: Partial<Row>) => setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const swap = (a: number, b: number) =>
    setRows((all) => {
      if (b < 0 || b >= all.length) return all;
      const copy = [...all];
      [copy[a], copy[b]] = [copy[b], copy[a]];
      return copy;
    });
  const value = JSON.stringify(
    rows.map((r) => ({ id: r.id, name: r.name, probability: r.probability.trim() === "" ? null : Math.round(Number(r.probability)), quoteStage: r.quoteStage })),
  );

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{words.stages}</legend>
      <input type="hidden" name="stages" value={value} />
      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.key} className="flex flex-col gap-2 rounded-md border border-line p-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
              {words.stageName}
              <input value={row.name} required maxLength={60} onChange={(e) => set(index, { name: e.target.value })} className={control} />
            </label>
            <label className="flex w-32 flex-col gap-1 text-sm font-medium">
              {words.probability}
              <input value={row.probability} inputMode="numeric" pattern="[0-9]*" maxLength={3} onChange={(e) => set(index, { probability: e.target.value })} className={control} />
            </label>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${group}-quote`}
                checked={row.quoteStage}
                onChange={() => setRows((all) => all.map((r, i) => ({ ...r, quoteStage: i === index })))}
              />
              {words.quoteStage}
            </label>
            <div className="flex gap-1">
              <Button kind="quiet" size="dense" disabled={index === 0} onClick={() => swap(index, index - 1)} aria-label={`${words.up}: ${row.name}`}>
                ↑
              </Button>
              <Button kind="quiet" size="dense" disabled={index === rows.length - 1} onClick={() => swap(index, index + 1)} aria-label={`${words.down}: ${row.name}`}>
                ↓
              </Button>
              <Button kind="quiet" size="dense" disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((_, i) => i !== index))}>
                {words.removeStage}
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">{words.probabilityHint}</p>
      {initial.some((s) => s.id) && <p className="text-sm text-muted">{words.removedNote}</p>}
      <Button
        kind="secondary"
        className="w-fit"
        disabled={rows.length >= 12}
        onClick={() => {
          setAdded((n) => n + 1);
          setRows((all) => [...all, { key: `${group}-new-${added}`, id: null, name: "", probability: "", quoteStage: false }]);
        }}
      >
        {words.addStage}
      </Button>
    </fieldset>
  );
}
