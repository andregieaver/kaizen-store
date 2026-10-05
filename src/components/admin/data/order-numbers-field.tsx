"use client";

import { useState, useTransition } from "react";

import { checkNumbersAction } from "@/app/admin/(gated)/[store]/orders/export/actions";

import { field, hint, secondary } from "./ui";

type Checked = { found: number; unknown: string[]; over: number } | { problem: string } | null;

/**
 * The pasted list of order numbers of the order export (D165, 2.3.1). *Check the numbers* tells which are the store's and lists back the ones that are
 * not, before a file is made; the file itself is asked for by the form, which needs no script.
 */
export function OrderNumbersField({ slug, defaultValue, max }: { slug: string; defaultValue: string; max: number }) {
  const [text, setText] = useState(defaultValue);
  const [checked, setChecked] = useState<Checked>(null);
  const [pending, start] = useTransition();
  const check = () =>
    start(async () => {
      const result = await checkNumbersAction(slug, text);
      setChecked(result.ok ? { found: result.found.length, unknown: result.unknown, over: result.over } : { problem: result.problem });
    });
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="export-numbers" className="sr-only">
        Order numbers
      </label>
      <textarea
        id="export-numbers"
        name="numbers"
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setChecked(null);
        }}
        placeholder="One order number on each line, or separated by commas"
        className={`${field} py-2`}
      />
      <p className={hint}>At most {max} order numbers. An order number is as it is shown in the orders list, without the #.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={check} disabled={pending || text.trim() === ""} className={secondary}>
          {pending ? "Checking …" : "Check the numbers"}
        </button>
        <div role="status" aria-live="polite" className="text-sm">
          {checked && "problem" in checked && <span className="text-red-700 dark:text-red-400">{checked.problem}</span>}
          {checked && "found" in checked && (
            <span>
              {checked.found} of these {checked.found === 1 ? "is an order" : "are orders"} of this store.
              {checked.unknown.length > 0 && <> Not found: {checked.unknown.slice(0, 20).join(", ")}{checked.unknown.length > 20 ? ` and ${checked.unknown.length - 20} more` : ""}.</>}
              {checked.over > 0 && <> {checked.over} too many: the file takes at most {max}.</>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
