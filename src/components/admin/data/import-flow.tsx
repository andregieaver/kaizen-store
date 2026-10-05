"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { IMPORT_MAX_BYTES } from "@/lib/data-limits";
import { IMPORT_CONFIRMATION, formatBytes, wholeNumber } from "@/lib/data-admin";
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
      router.push(`/admin/${slug}/products/import/${registered.jobId}`);
    } catch {
      setProblems(["The file could not be sent. Try again."]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={`${card} flex flex-col gap-3`} aria-busy={working}>
      <div className="flex flex-col gap-1">
        <label htmlFor="import-file" className={label}>
          A CSV file of products
        </label>
        <input id="import-file" ref={input} type="file" accept=".csv,text/csv" className={`${field} py-2`} />
        <p className={hint}>Up to {formatBytes(IMPORT_MAX_BYTES)}. Kaizen&apos;s own file (the one a product export makes) and a Shopify product file are read. Nothing is changed until you have seen the check and pressed Import.</p>
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

export type OptionChoices = {
  format: "kaizen" | "shopify";
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
  const router = useRouter();
  const [options, setOptions] = useState<ImportOptions>(choices.initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shopify = choices.format === "shopify";
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
      <h2 className="text-base font-semibold">What should the import do</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-mode" className={label}>
            What to do
          </label>
          <select id="opt-mode" value={options.mode} onChange={(e) => set("mode", e.target.value as ImportOptions["mode"])} className={field}>
            <option value="upsert">Create new products and update existing ones</option>
            <option value="create">Only create new products</option>
            <option value="update">Only update existing products</option>
          </select>
          <p className={hint}>A product is found by its handle. Nothing is ever deleted, and a handle is never changed.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-unpublishable" className={label}>
            A product that cannot be published
          </label>
          <select id="opt-unpublishable" value={options.unpublishable} onChange={(e) => set("unpublishable", e.target.value as ImportOptions["unpublishable"])} className={field}>
            <option value="draft">Save it as a draft and list why</option>
            <option value="skip">Skip it</option>
          </select>
          <p className={hint}>A product needs a picture, a price and, for physical goods, a manufacturer before it can be published.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-manufacturer" className={label}>
            Manufacturer for new physical products with none in the file
          </label>
          <select id="opt-manufacturer" value={options.manufacturerId ?? ""} onChange={(e) => set("manufacturerId", e.target.value === "" ? null : e.target.value)} className={field}>
            <option value="">None</option>
            {choices.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <p className={hint}>A Vendor in a Shopify file is never used as the manufacturer: that is a legal designation you make on purpose, under product safety.</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-missing" className={label}>
            Variants of an existing product that are not in the file
          </label>
          <select id="opt-missing" value={options.missingVariants} onChange={(e) => set("missingVariants", e.target.value as ImportOptions["missingVariants"])} className={field}>
            <option value="keep">Keep them as they are</option>
            <option value="switch_off">Switch them off (never deleted)</option>
          </select>
        </div>
      </div>
      {shopify && (
        <fieldset className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
          <legend className={`${label} px-1`}>This is a Shopify file</legend>
          <div className="flex flex-col gap-1">
            <span className={label}>Do the prices in the file include VAT?</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="basis" checked={options.pricesIncludeVat === true} onChange={() => set("pricesIncludeVat", true)} /> Yes, the prices include VAT
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="basis" checked={options.pricesIncludeVat === false} onChange={() => set("pricesIncludeVat", false)} /> No, the prices are without VAT
            </label>
            <p className={hint}>There is no default: a wrong answer would change every price. Kaizen prices are kept with VAT for each country.</p>
          </div>
          {choices.markets.length > 1 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="opt-market" className={label}>
                The market of the Price column
              </label>
              <select id="opt-market" value={options.priceMarket ?? choices.markets[0].code} onChange={(e) => set("priceMarket", e.target.value)} className={field}>
                {choices.markets.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name} ({m.currency})
                  </option>
                ))}
              </select>
              <p className={hint}>Prices are read in the country&apos;s own currency and never converted.</p>
            </div>
          )}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || needsBasis} className={primary}>
          {pending ? "Starting the check …" : checked ? "Check the file again" : "Check the file"}
        </button>
        {needsBasis && <span className={hint}>Say whether the prices include VAT first.</span>}
      </div>
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
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
    <section aria-label="Import" className={`${card} flex flex-col gap-3`} aria-busy={pending}>
      <h2 className="text-base font-semibold">Ready to import</h2>
      <p className="text-sm">
        {wholeNumber(counts.toCreate)} to create, {wholeNumber(counts.toUpdate)} to update, {wholeNumber(counts.unchanged)} unchanged
        {counts.withProblems > 0 ? `, ${wholeNumber(counts.withProblems)} with problems` : ""}.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3" role="group" aria-label="Confirm the import">
          <p className="text-sm">
            This will create {wholeNumber(counts.toCreate)} and update {wholeNumber(counts.toUpdate)} products. {IMPORT_CONFIRMATION}
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
          <button type="button" disabled={writes + counts.unchanged === 0} onClick={() => setConfirming(true)} className={primary}>
            Import …
          </button>
          <button type="button" disabled={pending} onClick={() => go(cancel)} className={secondary}>
            Cancel this import
          </button>
        </div>
      )}
      {writes === 0 && counts.unchanged === 0 && <p className={hint}>No product in this file can be imported. Fix the problems below, or change the options and check again.</p>}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
      </div>
    </section>
  );
}

/** Cancels a job that is being checked or applied; it stops after the current product and says how many were written. */
export function CancelJobButton({ cancel, label: text = "Cancel" }: { cancel: () => Promise<Step>; label?: string }) {
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
        {pending ? "Stopping …" : text}
      </button>
      {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
    </div>
  );
}
