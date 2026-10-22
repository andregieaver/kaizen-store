"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import { formatBytes, wholeNumber } from "@/lib/data-admin";
import { IMPORT_MAX_BYTES, REDIRECT_IMPORT_MAX_ROWS } from "@/lib/data-limits";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { existingChoiceWords, importConfirmation, type ExistingChoice } from "@/lib/redirect-admin";
import { redirectProblems } from "@/lib/redirect-words";
import { createClient } from "@/lib/supabase/client";

import { useAdminLang, useAdminText } from "../admin-text";

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
  const w = useAdminText("redirects");
  const u = w.import.upload;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const send = async () => {
    const file = input.current?.files?.[0];
    if (!file) {
      setProblems([u.chooseFirst]);
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      setProblems([u.notCsv]);
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setProblems([fillWords(u.tooBig, { size: formatBytes(file.size), max: formatBytes(IMPORT_MAX_BYTES) })]);
      return;
    }
    setProblems([]);
    setWorking(true);
    try {
      const started = await start(file.name);
      if (!started.ok) {
        setProblems(redirectProblems([started.problem], w));
        return;
      }
      const stored = await createClient()
        .storage.from(started.bucket)
        .uploadToSignedUrl(started.path, started.token, file, { contentType: TYPES.includes(file.type) ? file.type : "text/csv" });
      if (stored.error) {
        setProblems([u.didNotArrive]);
        return;
      }
      const registered = await register({ path: started.path, name: file.name });
      if (!registered.ok) {
        setProblems(redirectProblems(registered.problems, w));
        return;
      }
      router.push(`/admin/${slug}/redirects/import/${registered.jobId}`);
    } catch {
      setProblems([u.couldNotSend]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={working}>
      <div className="flex flex-col gap-1">
        <label htmlFor="redirect-file" className={label}>
          {u.label}
        </label>
        <input id="redirect-file" ref={input} type="file" accept=".csv,text/csv" className={`${field} py-2`} />
        <p className={hint}>
          {fillWords(u.hintA, { size: formatBytes(IMPORT_MAX_BYTES), lines: wholeNumber(REDIRECT_IMPORT_MAX_ROWS, locale) })} <strong>Redirect from</strong> {u.hintB} <strong>Redirect to</strong>
          {u.hintC}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={send} disabled={working} className={primary}>
          {working ? u.sending : u.send}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-danger-text">
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
  const w = useAdminText("redirects");
  const o = w.import.options;
  const choices = existingChoiceWords(w);
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
          if (!result.ok) setProblem(redirectProblems([result.problem], w)[0]);
          else router.refresh();
        });
      }}
    >
      <h2 className="text-title text-ink">{o.title}</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="redirect-existing" className={label}>
          {o.exists}
        </label>
        <select id="redirect-existing" value={existing} onChange={(e) => setExisting(e.target.value as ExistingChoice)} className={field}>
          {(Object.keys(choices) as ExistingChoice[]).map((choice) => (
            <option key={choice} value={choice}>
              {choices[choice].label}
            </option>
          ))}
        </select>
        <p className={hint}>{choices[existing].help}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? o.starting : checked ? o.checkAgain : o.check}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
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
  const w = useAdminText("redirects");
  const a = w.import.apply;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const n = (x: number) => wholeNumber(x, locale);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const writes = counts.toCreate + counts.toReplace;
  const go = (step: () => Promise<Step>) =>
    start(async () => {
      setProblem(null);
      const result = await step();
      if (!result.ok) setProblem(redirectProblems([result.problem], w)[0]);
      else router.refresh();
    });
  return (
    <section aria-label={a.label} className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-title text-ink">{a.title}</h2>
      <p className="text-sm">
        {fillWords(a.counts, { create: n(counts.toCreate), replace: n(counts.toReplace), unchanged: n(counts.unchanged) })}
        {counts.skipped > 0 ? fillWords(a.skipped, { n: n(counts.skipped) }) : ""}
        {counts.withErrors > 0 ? fillWords(a.withErrors, { n: n(counts.withErrors) }) : ""}.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-3" role="group" aria-label={a.confirmLabel}>
          <p className="text-sm">{importConfirmation(counts.toCreate, counts.toReplace, w, locale)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => go(apply)} className={primary}>
              {pending ? a.starting : a.yes}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={secondary}>
              {w.common.notYet}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={writes + counts.unchanged === 0} onClick={() => setConfirming(true)} className={primary}>
            {a.importEllipsis}
          </button>
          <button type="button" disabled={pending} onClick={() => go(cancel)} className={secondary}>
            {a.cancel}
          </button>
        </div>
      )}
      {writes + counts.unchanged === 0 && <p className={hint}>{a.nothing}</p>}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
      </div>
    </section>
  );
}
