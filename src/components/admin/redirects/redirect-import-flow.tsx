"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import { formatBytes, wholeNumber } from "@/lib/data-admin";
import { IMPORT_MAX_BYTES, REDIRECT_IMPORT_MAX_ROWS } from "@/lib/data-limits";
import { EXISTING_WORDS, importConfirmation, type ExistingChoice } from "@/lib/redirect-admin";
import { createClient } from "@/lib/supabase/client";

type Upload = { ok: true; path: string; token: string; bucket: string } | { ok: false; problem: string };
type Registered = { ok: true; jobId: string } | { ok: false; problems: string[] };
type Step = { ok: true } | { ok: false; problem: string };

const TYPES = ["text/csv", "text/plain", "application/vnd.ms-excel"];

/**
 * Choosing a redirect file (2.2.4 step 1): it goes straight from the browser to the private imports bucket with a signed upload (it can be 15 MB, larger than
 * a server request takes), then the server reads it and either refuses it with sentences or keeps it as a job, and the page moves on to the job. The browser
 * only checks the name and the size; the server checks everything again.
 */
export function RedirectUpload({
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
      router.push(`/admin/${slug}/redirects/import/${registered.jobId}`);
    } catch {
      setProblems(["The file could not be sent. Try again."]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={working}>
      <div className="flex flex-col gap-1">
        <label htmlFor="redirect-file" className={label}>
          A CSV file of redirects
        </label>
        <input id="redirect-file" ref={input} type="file" accept=".csv,text/csv" className={`${field} py-2`} />
        <p className={hint}>
          Up to {formatBytes(IMPORT_MAX_BYTES)} and {wholeNumber(REDIRECT_IMPORT_MAX_ROWS)} lines. The columns are <strong>Redirect from</strong> and <strong>Redirect to</strong>: a Shopify redirect file reads as it is, and so does the file the
          export makes. Nothing is changed until you have seen the check and pressed Import.
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

/**
 * The one option of a redirect import (2.2.4 step 2) and the dry run's button: what happens when an address already has a redirect of its own. Changing it
 * and pressing the button checks the file again; the import uses the option it was last checked with.
 */
export function RedirectImportOptions({ initial, check, checked }: { initial: ExistingChoice; check: (options: { existing: ExistingChoice }) => Promise<Step>; checked: boolean }) {
  const router = useRouter();
  const [existing, setExisting] = useState<ExistingChoice>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={`${card} flex flex-col gap-4`}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setProblem(null);
          const result = await check({ existing });
          if (!result.ok) setProblem(result.problem);
          else router.refresh();
        });
      }}
    >
      <h2 className="text-base font-semibold">What should the import do</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="redirect-existing" className={label}>
          A redirect from the same address already exists
        </label>
        <select id="redirect-existing" value={existing} onChange={(e) => setExisting(e.target.value as ExistingChoice)} className={field}>
          {(Object.keys(EXISTING_WORDS) as ExistingChoice[]).map((choice) => (
            <option key={choice} value={choice}>
              {EXISTING_WORDS[choice].label}
            </option>
          ))}
        </select>
        <p className={hint}>{EXISTING_WORDS[existing].help}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Starting the check …" : checked ? "Check the file again" : "Check the file"}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
      </div>
    </form>
  );
}

/** Importing a checked file: the counts, the confirmation of 2.2.4 step 4 and the button; and cancelling the import. */
export function RedirectImportApply({
  counts,
  apply,
  cancel,
}: {
  counts: { toCreate: number; toReplace: number; unchanged: number; skipped: number; withErrors: number };
  apply: () => Promise<Step>;
  cancel: () => Promise<Step>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const writes = counts.toCreate + counts.toReplace;
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
        {wholeNumber(counts.toCreate)} to create, {wholeNumber(counts.toReplace)} to replace, {wholeNumber(counts.unchanged)} unchanged
        {counts.skipped > 0 ? `, ${wholeNumber(counts.skipped)} skipped` : ""}
        {counts.withErrors > 0 ? `, ${wholeNumber(counts.withErrors)} with errors` : ""}.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3" role="group" aria-label="Confirm the import">
          <p className="text-sm">{importConfirmation(counts.toCreate, counts.toReplace)}</p>
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
          <button type="button" disabled={writes + counts.unchanged === 0} onClick={() => setConfirming(true)} className={primary}>
            Import …
          </button>
          <button type="button" disabled={pending} onClick={() => go(cancel)} className={secondary}>
            Cancel this import
          </button>
        </div>
      )}
      {writes + counts.unchanged === 0 && <p className={hint}>No line of this file can be imported. Fix the problems below, or change the option and check again.</p>}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
      </div>
    </section>
  );
}
