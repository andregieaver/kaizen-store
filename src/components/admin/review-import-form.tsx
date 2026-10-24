"use client";

import { useActionState } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { REVIEW_IMPORT_MAX, type ImportAction, type ImportState } from "@/lib/review-import";

import { useAdminText } from "./admin-text";
import { SubmitButton } from "./action-form";

/**
 * The review import's form (D301 G3b): a CSV file, where the reviews were written, whether they show at once, and *Only check the file*. What the
 * server found is drawn under it: how many can be (or were) imported, how many were already there, and each refused row by its line.
 */
export function ReviewImportForm({ action }: { action: ImportAction }) {
  const w = useAdminText("reviews").import;
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <div className="flex flex-col gap-5">
      <form action={formAction} aria-busy={pending} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-body">
          <span className="text-ink">{w.fileLabel}</span>
          <input type="file" name="file" accept=".csv,text/csv" required className="text-body" />
          <span className="text-caption text-muted">{fillWords(w.fileHint, { max: REVIEW_IMPORT_MAX.toLocaleString() })}</span>
        </label>
        <label className="flex flex-col gap-1 text-body">
          <span className="text-ink">{w.fromLabel}</span>
          <input name="from" defaultValue={w.fromDefault} maxLength={80} className="max-w-sm rounded-lg border border-line bg-card px-3 py-2" />
          <span className="text-caption text-muted">{w.fromHint}</span>
        </label>
        <fieldset className="flex flex-col gap-2 text-body">
          <legend className="mb-1 text-ink">{w.publishLabel}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="publish" value="check" defaultChecked />
            {w.publishCheck}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="publish" value="now" />
            {w.publishNow}
          </label>
        </fieldset>
        <label className="flex items-center gap-2 text-body text-ink">
          <input type="checkbox" name="check" defaultChecked />
          {w.checkOnly}
        </label>
        <p className="text-caption text-muted">{w.honest}</p>
        <div>
          <SubmitButton>{w.submit}</SubmitButton>
        </div>
      </form>
      {state && <ImportResult state={state} />}
    </div>
  );
}

function ImportResult({ state }: { state: NonNullable<ImportState> }) {
  const w = useAdminText("reviews").import;
  if (!state.ok) {
    const f = w.fileProblems;
    const text =
      state.problem === "columns"
        ? fillWords(f.columns, { missing: (("missing" in state && state.missing) || []).join(", ") })
        : state.problem === "too_many"
          ? fillWords(f.too_many, { max: REVIEW_IMPORT_MAX.toLocaleString() })
          : state.problem === "forbidden"
            ? f.closed
            : f[state.problem];
    return (
      <p role="alert" className="rounded-panel border border-danger-line bg-danger-soft p-3 text-body text-danger-text">
        {text}
      </p>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-2 rounded-panel border border-line bg-sunken p-3 text-body text-ink">
      <p>
        {state.checked ? countWords(state.imported, w.resultChecked) : countWords(state.imported, w.resultImported)}
        {!state.checked && state.imported > 0 ? ` ${state.published ? w.resultShown : w.resultWaiting}` : ""}
      </p>
      {state.duplicates > 0 && <p>{countWords(state.duplicates, w.duplicates)}</p>}
      {state.refusedCount > 0 && (
        <>
          <p>{countWords(state.refusedCount, w.refusedCount)}</p>
          <ul className="list-disc pl-5 text-caption">
            {state.refused.map((r) => (
              <li key={`${r.line}-${r.problem}`}>
                {fillWords(w.line, { n: r.line })}: {w.problems[r.problem]}
              </li>
            ))}
          </ul>
          {state.refusedCount > state.refused.length && <p className="text-caption">{fillWords(w.refusedMore, { n: state.refusedCount - state.refused.length })}</p>}
        </>
      )}
    </div>
  );
}
