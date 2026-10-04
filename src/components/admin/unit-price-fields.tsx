"use client";

import { useId, useState } from "react";

import type { StoreAudience } from "@/lib/b2b";
import type { MeasureInput, VariantInput } from "@/lib/product-input";
import { isUnit, packTotal, PACK_COUNT_MAX, basesFor } from "@/lib/unit-price";
import { smallBaseNote } from "@/lib/unit-price-rules";
import {
  CONTENT_UNITS,
  baseAfterUnitChange,
  compareChoices,
  contentPreviews,
  emptyContent,
  needWords,
  type ContentPreview,
  type ContentState,
} from "@/lib/unit-price-editor";

/**
 * The unit price in the product editor (D160, `docs/wave-1d-unit-price.md` 2.2): a variant's content (the pack's total, its
 * unit and what the price is compared per) with a live preview worked out by the same `unitPrice()` the shop uses, and the
 * product's "sold by measure" choice with what it still needs. The admin's tokens only. Nothing here decides what is shown
 * to shoppers: the editor sends the content and the server and the database hold the rules.
 */

const fieldBase = "min-h-9 rounded-md border border-border bg-background px-2 text-sm";
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
        <li key={`${line.market}-${i}`} className={line.shown ? "text-foreground" : "text-muted"}>
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
  const choices = compareChoices(shown.unit, marketCountries, shown.base);
  const previews = contentPreviews({
    content,
    prices: variant.prices,
    markets: context.markets,
    audience: context.audience,
    vatCategory: context.vatCategory,
    locale: context.locale,
  });

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3 sm:col-span-3 lg:col-span-5">
      <legend className="px-1 text-xs font-medium">Content, for the price per kg or litre</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Total content of {name}
          <input
            inputMode="decimal"
            value={shown.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="For example 250 or 0,75"
            aria-describedby={`${id}-preview`}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Unit
          <select
            value={shown.unit}
            onChange={(e) => {
              const unit = e.target.value;
              if (isUnit(unit)) set({ unit, base: baseAfterUnitChange(unit, shown.base) });
            }}
            aria-label={`Unit of the content of ${name}`}
            className={field}
          >
            {CONTENT_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Compare per
          <select
            value={shown.base ?? ""}
            onChange={(e) => set({ base: (e.target.value || null) as MeasureInput["base"] })}
            aria-label={`What the price of ${name} is compared per`}
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
      {basesFor(shown.unit).length > 1 && <p className="text-xs text-muted">{smallBaseNote(marketCountries)}</p>}
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1 font-medium">
          Pack of
          <input
            inputMode="numeric"
            value={pack}
            onChange={(e) => {
              setPack(e.target.value);
              setPackProblem(null);
            }}
            aria-label={`Number of items in the pack of ${name}`}
            className={`${fieldBase} w-20`}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const total = packTotal(pack, shown.amount);
            if (total === null) {
              setPackProblem(`Type the content of one item above and a whole number of items from 1 to ${PACK_COUNT_MAX}.`);
              return;
            }
            setPackProblem(null);
            set({ amount: total });
            setPack("");
          }}
          className="min-h-9 rounded-md border border-border px-3"
        >
          Multiply the content
        </button>
        <span className="text-muted">For several items in one pack: the content is the pack&apos;s total (6 × 33 cl is 198 cl).</span>
      </div>
      {packProblem && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {packProblem}
        </p>
      )}
      {content ? (
        <ContentPreviewList previews={previews} id={`${id}-preview`} />
      ) : (
        <p id={`${id}-preview`} className="text-xs text-muted">
          No content: shoppers see no price per kg or litre for this variant.
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
  const id = useId();
  const why = needWords(state.need);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-note`} className="mt-0.5 size-4" />
        <span>
          <span className="block font-medium">Sold by measure: every variant needs its content</span>
          <span id={`${id}-note`} className="text-muted">
            Shoppers see the price per kg, litre or metre beside the price. A product sold by measure cannot be put on sale while a
            shipped variant has no content.
          </span>
        </span>
      </label>
      {why && !checked && <p className="text-muted">{why}</p>}
      {state.nudge && <p className="text-muted">{state.nudge}</p>}
      {state.problems.length > 0 && (
        <div role="alert" className="text-red-700 dark:text-red-400">
          <p className="font-medium">This product cannot be saved yet:</p>
          <ProblemList problems={state.problems} />
        </div>
      )}
      {state.pending.length > 0 && (
        <div role="status" className="text-muted">
          <p className="font-medium">Before you publish this product:</p>
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
