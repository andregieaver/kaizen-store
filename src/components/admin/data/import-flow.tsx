"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { IMPORT_MAX_BYTES } from "@/lib/data-limits";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { formatBytes, wholeNumber } from "@/lib/data-admin";
import { createClient } from "@/lib/supabase/client";
import type { ImportOptions } from "@/lib/product-import";

import { card, field, hint, label, primary, secondary } from "./ui";

type Upload = { ok: true; path: string; token: string; bucket: string } | { ok: false; problem: string };
type Registered = { ok: true; jobId: string } | { ok: false; problems: string[] };
type Step = { ok: true } | { ok: false; problem: string };

const TYPES = ["text/csv", "text/plain", "application/vnd.ms-excel"];

/**
 * Choosing a file for the product import (D165, `docs/wave-2-data.md` 2.2.1): the file goes straight from the browser to the private imports bucket
 * with a signed upload (it can be 15 MB, larger than a server request takes), then the server reads it and either refuses it with a sentence or keeps it
 * as a job, and the page moves on to the job. The browser only checks the name and the size; the server checks everything again.
 */
export function ImportUpload({
  slug,
  start,
  register,
}: {
  slug: string;
  start: (fileName: string) => Promise<Upload>;
  register: (input: { path: string; name: string }) => Promise<Registered>;
}) {
  const w = useAdminText("products").upload;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const send = async () => {
    const file = input.current?.files?.[0];
    if (!file) {
      setProblems([w.chooseFile]);
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
      router.push(`/admin/${slug}/products/import/${registered.jobId}`);
    } catch {
      setProblems([w.couldNotSend]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={working}>
      <div className="flex flex-col gap-1">
        <label htmlFor="import-file" className={label}>
          {w.label}
        </label>
        <input id="import-file" ref={input} type="file" accept=".csv,text/csv" className={`${field} py-2`} />
        <p className={hint}>{fillWords(w.hint, { max: formatBytes(IMPORT_MAX_BYTES) })}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={send} disabled={working} className={primary}>
          {working ? w.sending : w.upload}
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

export type OptionChoices = {
  format: "kaizen" | "shopify" | "woocommerce";
  markets: { code: string; name: string; currency: string }[];
  operators: { id: string; name: string }[];
  initial: ImportOptions;
  /** The store sells only to businesses: the prices of a Kaizen file are entered without VAT. */
  audience: "consumers" | "businesses" | "both";
};

/**
 * The options of an import and the dry run's button (2.2.2, 2.2.3). A Shopify file has to say whether its prices include VAT: there is no default, because
 * a wrong guess changes every price. Changing an option of a checked file and pressing the button checks it again.
 */
export function ImportOptionsForm({ choices, check, checked }: { choices: OptionChoices; check: (options: ImportOptions) => Promise<Step>; checked: boolean }) {
  const w = useAdminText("products").options;
  const router = useRouter();
  const [options, setOptions] = useState<ImportOptions>(choices.initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A file from another shop (Shopify's or WooCommerce's): its prices' VAT, their market and the old addresses' redirects are asked.
  const shopify = choices.format !== "kaizen";
  const set = <K extends keyof ImportOptions>(key: K, value: ImportOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const needsBasis = shopify && options.pricesIncludeVat === null;

  const run = () =>
    start(async () => {
      setProblem(null);
      const result = await check(options);
      if (!result.ok) setProblem(result.problem);
      else router.refresh();
    });

  return (
    <form
      className={`${card} flex flex-col gap-4`}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
    >
      <h2 className="text-title text-ink">{w.heading}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-mode" className={label}>
            {w.mode}
          </label>
          <select id="opt-mode" value={options.mode} onChange={(e) => set("mode", e.target.value as ImportOptions["mode"])} className={field}>
            <option value="upsert">{w.upsert}</option>
            <option value="create">{w.create}</option>
            <option value="update">{w.update}</option>
          </select>
          <p className={hint}>{w.modeHint}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-unpublishable" className={label}>
            {w.unpublishable}
          </label>
          <select id="opt-unpublishable" value={options.unpublishable} onChange={(e) => set("unpublishable", e.target.value as ImportOptions["unpublishable"])} className={field}>
            <option value="draft">{w.asDraft}</option>
            <option value="skip">{w.skip}</option>
          </select>
          <p className={hint}>{w.unpublishableHint}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-manufacturer" className={label}>
            {w.manufacturer}
          </label>
          <select id="opt-manufacturer" value={options.manufacturerId ?? ""} onChange={(e) => set("manufacturerId", e.target.value === "" ? null : e.target.value)} className={field}>
            <option value="">{w.none}</option>
            {choices.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <p className={hint}>{w.manufacturerHint}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-missing" className={label}>
            {w.missing}
          </label>
          <select id="opt-missing" value={options.missingVariants} onChange={(e) => set("missingVariants", e.target.value as ImportOptions["missingVariants"])} className={field}>
            <option value="keep">{w.keep}</option>
            <option value="switch_off">{w.switchOff}</option>
          </select>
        </div>
      </div>
      {shopify && (
        <fieldset className="flex flex-col gap-3 rounded-md border border-line bg-card p-3">
          <legend className={`${label} px-1`}>{choices.format === "woocommerce" ? w.woocommerce : w.shopify}</legend>
          <div className="flex flex-col gap-1">
            <span className={label}>{w.vatQuestion}</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="basis" checked={options.pricesIncludeVat === true} onChange={() => set("pricesIncludeVat", true)} /> {w.vatYes}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="basis" checked={options.pricesIncludeVat === false} onChange={() => set("pricesIncludeVat", false)} /> {w.vatNo}
            </label>
            <p className={hint}>{w.vatHint}</p>
          </div>
          {choices.markets.length > 1 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="opt-market" className={label}>
                {w.market}
              </label>
              <select id="opt-market" value={options.priceMarket ?? choices.markets[0].code} onChange={(e) => set("priceMarket", e.target.value)} className={field}>
                {choices.markets.map((m) => (
                  <option key={m.code} value={m.code}>
                    {fillWords(w.marketLine, { name: m.name, currency: m.currency })}
                  </option>
                ))}
              </select>
              <p className={hint}>{w.marketHint}</p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={options.redirects} onChange={(e) => set("redirects", e.target.checked)} />
              {fillWords(w.redirects, { path: choices.format === "woocommerce" ? "/product/…" : "/products/…" })}
            </label>
            <p className={hint}>{w.redirectsHint}</p>
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || needsBasis} className={primary}>
          {pending ? w.starting : checked ? w.checkAgain : w.check}
        </button>
        {needsBasis && <span className={hint}>{w.needsBasis}</span>}
      </div>
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
      </div>
    </form>
  );
}

/** Importing a checked file: counts, the confirmation of 2.2.4 and the button; and cancelling the import. */
export function ImportApply({
  counts,
  apply,
  cancel,
}: {
  counts: { toCreate: number; toUpdate: number; unchanged: number; withProblems: number };
  apply: () => Promise<Step>;
  cancel: () => Promise<Step>;
}) {
  const all = useAdminText("products");
  const w = all.apply;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const n = (value: number) => wholeNumber(value, locale);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const writes = counts.toCreate + counts.toUpdate;
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
        {fillWords(w.counts, {
          create: n(counts.toCreate),
          update: n(counts.toUpdate),
          unchanged: n(counts.unchanged),
          problems: counts.withProblems > 0 ? fillWords(w.withProblems, { n: n(counts.withProblems) }) : "",
        })}
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-3" role="group" aria-label={w.confirmLabel}>
          <p className="text-sm">
            {fillWords(w.confirm, { create: n(counts.toCreate), update: n(counts.toUpdate) })} {all.importNotes.confirmation}
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
          <button type="button" disabled={writes + counts.unchanged === 0} onClick={() => setConfirming(true)} className={primary}>
            {w.importButton}
          </button>
          <button type="button" disabled={pending} onClick={() => go(cancel)} className={secondary}>
            {w.cancel}
          </button>
        </div>
      )}
      {writes === 0 && counts.unchanged === 0 && <p className={hint}>{w.nothing}</p>}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
      </div>
    </section>
  );
}

/** Cancels a job that is being checked or applied; it stops after the current product and says how many were written. */
export function CancelJobButton({ cancel, label: text = "Cancel", stopping = "Stopping …" }: { cancel: () => Promise<Step>; label?: string; stopping?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={secondary}
        onClick={() =>
          start(async () => {
            const result = await cancel();
            if (!result.ok) setProblem(result.problem);
            else router.refresh();
          })
        }
      >
        {pending ? stopping : text}
      </button>
      {problem && <p role="alert" className="text-sm text-danger-text">{problem}</p>}
    </div>
  );
}
