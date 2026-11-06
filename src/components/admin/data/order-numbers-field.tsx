"use client";

import { useState, useTransition } from "react";

import { checkNumbersAction } from "@/app/admin/(gated)/[store]/orders/export/actions";

import { field, hint, secondary } from "./ui";
import { useAdminText } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";

type Checked = { found: number; unknown: string[]; over: number } | { problem: string } | null;

/**
 * The pasted list of order numbers of the order export (D165, 2.3.1). *Check the numbers* tells which are the store's and lists back the ones that are
 * not, before a file is made; the file itself is asked for by the form, which needs no script.
 */
export function OrderNumbersField({ slug, defaultValue, max }: { slug: string; defaultValue: string; max: number }) {
  const w = useAdminText("orders").numbersField;
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
        {w.label}
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
        placeholder={w.placeholder}
        className={`${field} py-2`}
      />
      <p className={hint}>{fillWords(w.atMost, { max })}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={check} disabled={pending || text.trim() === ""} className={secondary}>
          {pending ? w.checking : w.check}
        </button>
        <div role="status" aria-live="polite" className="text-sm">
          {checked && "problem" in checked && <span className="text-danger-text">{checked.problem}</span>}
          {checked && "found" in checked && (
            <span>
              {countWords(checked.found, w.found)}
              {checked.unknown.length > 0 &&
                fillWords(w.notFound, {
                  list:
                    checked.unknown.length > 20
                      ? fillWords(w.andMore, { list: checked.unknown.slice(0, 20).join(", "), n: checked.unknown.length - 20 })
                      : checked.unknown.join(", "),
                })}
              {checked.over > 0 && fillWords(w.tooMany, { n: checked.over, max })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
