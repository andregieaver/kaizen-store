"use client";

import { useId, useState } from "react";

import type { StoreAudience } from "@/lib/b2b";
import type { MeasureInput, VariantInput } from "@/lib/product-input";
import { fillWords } from "@/lib/admin-fill";
import { isUnit, packTotal, PACK_COUNT_MAX, basesFor } from "@/lib/unit-price";
import {
  baseAfterUnitChange,
  compareChoices,
  contentPreviews,
  contentUnits,
  emptyContent,
  needWords,
  smallBaseWords,
  type ContentPreview,
  type ContentState,
} from "@/lib/unit-price-editor";

import { useAdminText } from "./admin-text";

/**
 * The unit price in the product editor (D160, `docs/wave-1d-unit-price.md` 2.2): a variant's content (the pack's total, its
 * unit and what the price is compared per) with a live preview worked out by the same `unitPrice()` the shop uses, and the
 * product's "sold by measure" choice with what it still needs. The admin's tokens only. Nothing here decides what is shown
 * to shoppers: the editor sends the content and the server and the database hold the rules.
 */

const fieldBase = "min-h-9 rounded-md border border-line bg-card px-2 text-sm";
const field = `${fieldBase} w-full`;

/** What the preview needs of the store and the product (the variant's own prices come from the variant). */
export type ContentContext = {
  markets: { code: string; name: string; currency: string; vatRates: Record<string, number> }[];
  audience: StoreAudience;
  vatCategory: string;
  locale: string;
};

/** The lines under a variant's content: what the shop will show per market, or why it will not. */
export function ContentPreviewList({ previews, id }: { previews: ContentPreview[]; id?: string }) {
  if (previews.length === 0) return null;
  return (
    <ul id={id} aria-live="polite" className="flex flex-col gap-0.5 text-xs">
      {previews.map((line, i) => (
        <li key={`${line.market}-${i}`} className={line.shown ? "text-ink" : "text-muted"}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/** A variant's total content, its unit and what the price is compared per, with the pack helper and the live preview. */
export function ContentFields({
  name,
  variant,
  context,
  onChange,
}: {
  /** The variant as the owner reads it ("Large / Red"), for the field labels. */
  name: string;
  variant: VariantInput;
  context: ContentContext;
  onChange: (measure: MeasureInput | null) => void;
}) {
  const words = useAdminText("product").unitPrice;
  const w = words.fields;
  const id = useId();
  const content = variant.measure;
  const shown = content ?? emptyContent();
  const [pack, setPack] = useState("");
  const [packProblem, setPackProblem] = useState<string | null>(null);
  const set = (change: Partial<MeasureInput>) => {
    const next = { ...shown, ...change };
    // Nothing typed and no choice made: the variant has no content.
    onChange(next.amount.trim() === "" && next.unit === "g" && next.base === null ? null : next);
  };
  const marketCountries = context.markets.map((m) => m.code);
  const choices = compareChoices(shown.unit, marketCountries, shown.base, words.editor);
  const previews = contentPreviews({
    content,
    prices: variant.prices,
    markets: context.markets,
    audience: context.audience,
    vatCategory: context.vatCategory,
    locale: context.locale,
    words: words.editor,
  });

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3 sm:col-span-3 lg:col-span-5">
      <legend className="px-1 text-xs font-medium">{w.legend}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          {fillWords(w.total, { name })}
          <input
            inputMode="decimal"
            value={shown.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder={w.totalPlaceholder}
            aria-describedby={`${id}-preview`}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          {w.unit}
          <select
            value={shown.unit}
            onChange={(e) => {
              const unit = e.target.value;
              if (isUnit(unit)) set({ unit, base: baseAfterUnitChange(unit, shown.base) });
            }}
            aria-label={fillWords(w.unitOf, { name })}
            className={field}
          >
            {contentUnits(words.editor).map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          {w.comparePer}
          <select
            value={shown.base ?? ""}
            onChange={(e) => set({ base: (e.target.value || null) as MeasureInput["base"] })}
            aria-label={fillWords(w.comparedPer, { name })}
            className={field}
          >
            {choices.map((c) => (
              <option key={c.value ?? "default"} value={c.value ?? ""}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {basesFor(shown.unit).length > 1 && <p className="text-xs text-muted">{smallBaseWords(marketCountries, words.editor)}</p>}
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1 font-medium">
          {w.packOf}
          <input
            inputMode="numeric"
            value={pack}
            onChange={(e) => {
              setPack(e.target.value);
              setPackProblem(null);
            }}
            aria-label={fillWords(w.packCount, { name })}
            className={`${fieldBase} w-20`}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const total = packTotal(pack, shown.amount);
            if (total === null) {
              setPackProblem(fillWords(w.packProblem, { max: PACK_COUNT_MAX }));
              return;
            }
            setPackProblem(null);
            set({ amount: total });
            setPack("");
          }}
          className="min-h-9 rounded-md border border-line px-3"
        >
          {w.multiply}
        </button>
        <span className="text-muted">{w.packHint}</span>
      </div>
      {packProblem && (
        <p role="alert" className="text-xs text-danger-text">
          {packProblem}
        </p>
      )}
      {content ? (
        <ContentPreviewList previews={previews} id={`${id}-preview`} />
      ) : (
        <p id={`${id}-preview`} className="text-xs text-muted">
          {w.noContent}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The product-level choice: every variant needs its content ("sold by measure"), what the product needs now and why, which
 * variants are missing theirs, and the nudge for food. A nudge never stops a save; a refusal (an active product that needs
 * content) is the server's and the database's, and here it is only said before pressing Save. A draft is told what it will
 * need once it is published.
 */
export function SoldByMeasureField({ checked, onChange, state }: { checked: boolean; onChange: (checked: boolean) => void; state: ContentState }) {
  const words = useAdminText("product").unitPrice;
  const w = words.fields;
  const id = useId();
  const why = needWords(state.need, words.editor);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-note`} className="mt-0.5 size-4" />
        <span>
          <span className="block font-medium">{w.soldByMeasure}</span>
          <span id={`${id}-note`} className="text-muted">
            {w.soldByMeasureNote}
          </span>
        </span>
      </label>
      {why && !checked && <p className="text-muted">{why}</p>}
      {state.nudge && <p className="text-muted">{state.nudge}</p>}
      {state.problems.length > 0 && (
        <div role="alert" className="text-danger-text">
          <p className="font-medium">{w.cannotSave}</p>
          <ProblemList problems={state.problems} />
        </div>
      )}
      {state.pending.length > 0 && (
        <div role="status" className="text-muted">
          <p className="font-medium">{w.beforePublish}</p>
          <ProblemList problems={state.pending} />
        </div>
      )}
    </div>
  );
}

function ProblemList({ problems }: { problems: ContentState["problems"] }) {
  return (
    <ul className="list-disc pl-5">
      {problems.map((problem) => (
        <li key={`${problem.code}-${problem.sku}`}>{problem.message}</li>
      ))}
    </ul>
  );
}
