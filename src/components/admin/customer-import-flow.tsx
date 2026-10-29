"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import type { ImportWords } from "@/components/admin/customer-import-views";
import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { IMPORT_MAX_BYTES } from "@/lib/data-limits";
import { bytesIn, numberIn } from "@/lib/inventory-words";
import { createClient } from "@/lib/supabase/client";

type Upload = { ok: true; path: string; token: string; bucket: string } | { ok: false; problem: string };
type Registered = { ok: true; jobId: string } | { ok: false; problems: string[] };
type Step = { ok: true } | { ok: false; problem: string };

const TYPES = ["text/csv", "text/plain", "application/vnd.ms-excel"];

/**
 * The customer import's steps in the browser (wave 10 unit C, D366), as the stock import's (D172): the file goes straight to the private
 * imports bucket with a signed upload, the server reads it and keeps it as a job or refuses it with sentences; then the check, and the
 * import with its confirmation. The browser checks only the name and the size; the server checks everything again. The words shared with
 * the stock import (a file's upload, the check, the buttons) are the `inventory` catalogue's; the customer import's own are `customers`.
 */
export function CustomerUpload({
  slug,
  rowsMax,
  start,
  register,
  jobBase,
  words,
}: {
  slug: string;
  rowsMax: number;
  start: (fileName: string) => Promise<Upload>;
  register: (input: { path: string; name: string }) => Promise<Registered>;
  /** Where a registered job's page is, after the store's address (the order history's, D384); the customer import's by default. */
  jobBase?: string;
  words?: Pick<ImportWords, "fileLabel" | "hint">;
}) {
  const router = useRouter();
  const w = useAdminText("inventory").import.upload;
  const customers = useAdminText("customers").staff.import;
  const own = words ?? customers;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const send = async () => {
    const file = input.current?.files?.[0];
    if (!file) return setProblems([w.chooseFirst]);
    if (!/\.csv$/i.test(file.name)) return setProblems([w.notCsv]);
    if (file.size > IMPORT_MAX_BYTES) return setProblems([fillWords(w.tooLarge, { size: bytesIn(file.size, locale), max: bytesIn(IMPORT_MAX_BYTES, locale) })]);
    setProblems([]);
    setWorking(true);
    try {
      const started = await start(file.name);
      if (!started.ok) return setProblems([started.problem]);
      const stored = await createClient()
        .storage.from(started.bucket)
        .uploadToSignedUrl(started.path, started.token, file, { contentType: TYPES.includes(file.type) ? file.type : "text/csv" });
      if (stored.error) return setProblems([w.didNotArrive]);
      const registered = await register({ path: started.path, name: file.name });
      if (!registered.ok) return setProblems(registered.problems);
      router.push(`/admin/${slug}${jobBase ?? "/customers/import"}/${registered.jobId}`);
    } catch {
      setProblems([w.notSent]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={working}>
      <div className="flex flex-col gap-1">
        <label htmlFor="customer-file" className={label}>
          {own.fileLabel}
        </label>
        <input id="customer-file" ref={input} type="file" accept=".csv,text/csv" className={`${field} py-2`} />
        <p className={hint}>{fillWords(own.hint, { size: bytesIn(IMPORT_MAX_BYTES, locale), rows: numberIn(rowsMax, locale) })}</p>
      </div>
      <div>
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

/** The dry run's button: *Check the file*, or *Check the file again* after a check. Nothing about anyone is written. */
export function CustomerCheck({ check, checked }: { check: () => Promise<Step>; checked: boolean }) {
  const router = useRouter();
  const w = useAdminText("inventory").import.check;
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-title text-ink">{checked ? w.again : w.first}</h2>
      <div>
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
export function CustomerImportApply({
  counts,
  apply,
  cancel,
  words,
}: {
  counts: { toCreate: number; toUpdate: number; withProblems: number };
  apply: () => Promise<Step>;
  cancel: () => Promise<Step>;
  words?: Pick<ImportWords, "ready" | "counts" | "skippedRows" | "confirm">;
}) {
  const router = useRouter();
  const shared = useAdminText("inventory").import.apply;
  const customers = useAdminText("customers").staff.import;
  const w = words ?? customers;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const n = (value: number) => numberIn(value, locale);
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
  const writes = counts.toCreate + counts.toUpdate;
  return (
    <section aria-label={shared.label} className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-title text-ink">{w.ready}</h2>
      <p className="text-sm">
        {fillWords(w.counts, { toCreate: n(counts.toCreate), toUpdate: n(counts.toUpdate) })}
        {counts.withProblems > 0 ? fillWords(w.skippedRows, { n: n(counts.withProblems) }) : ""}.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-3" role="group" aria-label={shared.confirmLabel}>
          <p className="text-sm">{countWords(writes, w.confirm, { n: n(writes) })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => go(apply)} className={primary}>
              {pending ? shared.starting : shared.yes}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={secondary}>
              {shared.notYet}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={writes === 0} onClick={() => setConfirming(true)} className={primary}>
            {shared.importEllipsis}
          </button>
          <button type="button" disabled={pending} onClick={() => go(cancel)} className={secondary}>
            {shared.cancel}
          </button>
        </div>
      )}
      {writes === 0 && <p className={hint}>{shared.nothing}</p>}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
      </div>
    </section>
  );
}
