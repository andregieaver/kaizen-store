"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { IMPORT_MAX_BYTES } from "@/lib/data-limits";
import { INVENTORY_FILE_ROWS_MAX } from "@/lib/inventory";
import { bytesIn, numberIn } from "@/lib/inventory-words";
import { createClient } from "@/lib/supabase/client";

type Upload = { ok: true; path: string; token: string; bucket: string } | { ok: false; problem: string };
type Registered = { ok: true; jobId: string } | { ok: false; problems: string[] };
type Step = { ok: true } | { ok: false; problem: string };

const TYPES = ["text/csv", "text/plain", "application/vnd.ms-excel"];

/**
 * Choosing a stock file (wave 3, D172, `docs/wave-3-inventory.md` 2.4, step 1): it goes straight from the browser to the private imports bucket with a signed
 * upload, then the server reads it and either refuses it with sentences or keeps it as a job, and the page moves on to the job. The browser only checks the
 * name and the size; the server checks everything again. In the admin's language (`useAdminText("inventory")`, D312 A5); the server's refusals keep its words.
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
  const w = useAdminText("inventory").import.upload;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const formatBytes = (n: number) => bytesIn(n, locale);
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const send = async () => {
    const file = input.current?.files?.[0];
    if (!file) {
      setProblems([w.chooseFirst]);
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      setProblems([w.notCsv]);
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setProblems([fillWords(w.tooLarge, { size: formatBytes(file.size), max: formatBytes(IMPORT_MAX_BYTES) })]);
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
        setProblems([w.didNotArrive]);
        return;
      }
      const registered = await register({ path: started.path, name: file.name });
      if (!registered.ok) {
        setProblems(registered.problems);
        return;
      }
      router.push(`/admin/${slug}/inventory/import/${registered.jobId}`);
    } catch {
      setProblems([w.notSent]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={working}>
      <div className="flex flex-col gap-1">
        <label htmlFor="stock-file" className={label}>
          {w.fileLabel}
        </label>
        <input id="stock-file" ref={input} type="file" accept=".csv,text/csv" className={`${field} py-2`} />
        <p className={hint}>
          {fillWords(w.hintStart, { size: formatBytes(IMPORT_MAX_BYTES), rows: numberIn(INVENTORY_FILE_ROWS_MAX, locale) })} <strong>sku</strong> {w.hintAnd} <strong>on_hand</strong> {w.hintCounted} <strong>location</strong>,{" "}
          <strong>on_hand_was</strong>, <strong>reason</strong>, <strong>note</strong>, <strong>stock_policy</strong>, <strong>backorder_days</strong> {w.hintAnd} <strong>low_stock_threshold</strong>. {w.hintEnd}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={send} disabled={working} className={primary}>
          {working ? w.sending : w.send}
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

/** The dry run's button (step 2): there are no options, so it is only *Check the file*, or *Check the file again* after a check. */
export function StockCheck({ check, checked }: { check: () => Promise<Step>; checked: boolean }) {
  const router = useRouter();
  const w = useAdminText("inventory").import.check;
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-title text-ink">{checked ? w.again : w.first}</h2>
      <p className="text-sm text-muted">{w.text}</p>
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
          {pending ? w.starting : checked ? w.again : w.first}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
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
  const w = useAdminText("inventory").import.apply;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const wholeNumber = (n: number) => numberIn(Math.round(n), locale);
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
    <section aria-label={w.label} className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-title text-ink">{w.ready}</h2>
      <p className="text-sm">
        {fillWords(w.counts, { toUpdate: wholeNumber(counts.toUpdate), unchanged: wholeNumber(counts.unchanged) })}
        {counts.conflicts > 0 ? fillWords(w.outOfDate, { n: wholeNumber(counts.conflicts) }) : ""}
        {counts.withProblems > 0 ? fillWords(w.withProblems, { n: wholeNumber(counts.withProblems) }) : ""}.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-3" role="group" aria-label={w.confirmLabel}>
          <p className="text-sm">
            {countWords(counts.toUpdate, w.confirm, { n: wholeNumber(counts.toUpdate) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => go(apply)} className={primary}>
              {pending ? w.starting : w.yes}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={secondary}>
              {w.notYet}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={counts.toUpdate + counts.unchanged === 0} onClick={() => setConfirming(true)} className={primary}>
            {w.importEllipsis}
          </button>
          <button type="button" disabled={pending} onClick={() => go(cancel)} className={secondary}>
            {w.cancel}
          </button>
        </div>
      )}
      {counts.toUpdate + counts.unchanged === 0 && <p className={hint}>{w.nothing}</p>}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
      </div>
    </section>
  );
}
