"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import { formatBytes, wholeNumber } from "@/lib/data-admin";
import { IMPORT_MAX_BYTES } from "@/lib/data-limits";
import { INVENTORY_FILE_ROWS_MAX } from "@/lib/inventory";
import { createClient } from "@/lib/supabase/client";

type Upload = { ok: true; path: string; token: string; bucket: string } | { ok: false; problem: string };
type Registered = { ok: true; jobId: string } | { ok: false; problems: string[] };
type Step = { ok: true } | { ok: false; problem: string };

const TYPES = ["text/csv", "text/plain", "application/vnd.ms-excel"];

/**
 * Choosing a stock file (wave 3, D172, `docs/wave-3-inventory.md` 2.4, step 1): it goes straight from the browser to the private imports bucket with a signed
 * upload, then the server reads it and either refuses it with sentences or keeps it as a job, and the page moves on to the job. The browser only checks the
 * name and the size; the server checks everything again.
 */
export function StockUpload({
  slug,
  start,
  register,
}: {
  slug: string;
  start: (fileName: string) => Promise<Upload>;
  register: (input: { path: string; name: string }) => Promise<Registered>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const send = async () => {
    const file = input.current?.files?.[0];
    if (!file) {
      setProblems(["Choose a CSV file first."]);
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      setProblems(["The file must be a .csv file. In Excel, use Save as and choose CSV."]);
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setProblems([`The file is ${formatBytes(file.size)} and an import takes at most ${formatBytes(IMPORT_MAX_BYTES)}. Split it into smaller files.`]);
      return;
    }
    setProblems([]);
    setWorking(true);
    try {
      const started = await start(file.name);
      if (!started.ok) {
        setProblems([started.problem]);
        return;
      }
      const stored = await createClient()
        .storage.from(started.bucket)
        .uploadToSignedUrl(started.path, started.token, file, { contentType: TYPES.includes(file.type) ? file.type : "text/csv" });
      if (stored.error) {
        setProblems(["The file did not arrive. Try again."]);
        return;
      }
      const registered = await register({ path: started.path, name: file.name });
      if (!registered.ok) {
        setProblems(registered.problems);
        return;
      }
      router.push(`/admin/${slug}/inventory/import/${registered.jobId}`);
    } catch {
      setProblems(["The file could not be sent. Try again."]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={working}>
      <div className="flex flex-col gap-1">
        <label htmlFor="stock-file" className={label}>
          A CSV file of stock
        </label>
        <input id="stock-file" ref={input} type="file" accept=".csv,text/csv" className={`${field} py-2`} />
        <p className={hint}>
          Up to {formatBytes(IMPORT_MAX_BYTES)} and {wholeNumber(INVENTORY_FILE_ROWS_MAX)} rows. The columns are <strong>sku</strong> and <strong>on_hand</strong> (the counted figure), and, when you need them, <strong>location</strong>,{" "}
          <strong>on_hand_was</strong>, <strong>reason</strong>, <strong>note</strong>, <strong>stock_policy</strong>, <strong>backorder_days</strong> and <strong>low_stock_threshold</strong>. The file the stock export makes reads as it is.
          Nothing is changed until you have seen the check and pressed Import.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={send} disabled={working} className={primary}>
          {working ? "Sending the file …" : "Upload and read the file"}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-400">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The dry run's button (step 2): there are no options, so it is only *Check the file*, or *Check the file again* after a check. */
export function StockCheck({ check, checked }: { check: () => Promise<Step>; checked: boolean }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-base font-semibold">{checked ? "Check the file again" : "Check the file"}</h2>
      <p className="text-sm text-muted">The check reads every row against the stock as it is now and lists what an import would do. It changes nothing.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={primary}
          onClick={() =>
            start(async () => {
              setProblem(null);
              const result = await check();
              if (!result.ok) setProblem(result.problem);
              else router.refresh();
            })
          }
        >
          {pending ? "Starting the check …" : checked ? "Check the file again" : "Check the file"}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
      </div>
    </div>
  );
}

/** Importing a checked file: the counts, the confirmation and the button; and cancelling the import. */
export function StockImportApply({
  counts,
  apply,
  cancel,
}: {
  counts: { toUpdate: number; unchanged: number; conflicts: number; withProblems: number };
  apply: () => Promise<Step>;
  cancel: () => Promise<Step>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (step: () => Promise<Step>) =>
    start(async () => {
      setProblem(null);
      const result = await step();
      if (!result.ok) setProblem(result.problem);
      else router.refresh();
    });
  return (
    <section aria-label="Import" className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-base font-semibold">Ready to import</h2>
      <p className="text-sm">
        {wholeNumber(counts.toUpdate)} to change, {wholeNumber(counts.unchanged)} unchanged
        {counts.conflicts > 0 ? `, ${wholeNumber(counts.conflicts)} out of date` : ""}
        {counts.withProblems > 0 ? `, ${wholeNumber(counts.withProblems)} with problems` : ""}.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3" role="group" aria-label="Confirm the import">
          <p className="text-sm">
            This will change the stock of {wholeNumber(counts.toUpdate)} {counts.toUpdate === 1 ? "variant at a location" : "variants at locations"}. Each change is kept in the history with the reason of its row (a count, unless the file says otherwise). A row whose
            stock has changed since the file was made is left alone when the file says what it was made from, and each row is checked again as it is written. Nothing is deleted.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => go(apply)} className={primary}>
              {pending ? "Starting …" : "Yes, import"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={secondary}>
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={counts.toUpdate + counts.unchanged === 0} onClick={() => setConfirming(true)} className={primary}>
            Import …
          </button>
          <button type="button" disabled={pending} onClick={() => go(cancel)} className={secondary}>
            Cancel this import
          </button>
        </div>
      )}
      {counts.toUpdate + counts.unchanged === 0 && <p className={hint}>No row of this file can be imported. Fix the problems below and upload the file again.</p>}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
      </div>
    </section>
  );
}
