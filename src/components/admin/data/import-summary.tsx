import { type AppliedCounts, wholeNumber } from "@/lib/data-admin";

import { card, hint } from "./ui";

/** The numbers of a dry run: what an import would do. */
export function DryRunSummary({ counts }: { counts: { toCreate: number; toUpdate: number; unchanged: number; withProblems: number } }) {
  const items: [string, number][] = [
    ["To create", counts.toCreate],
    ["To update", counts.toUpdate],
    ["Unchanged", counts.unchanged],
    ["With problems", counts.withProblems],
  ];
  return (
    <section aria-label="What the check found" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">What the check found</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-2xl font-semibold">{wholeNumber(n)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>Nothing has changed in your store. A product with an error is skipped: nothing of it is written.</p>
    </section>
  );
}

/** The outcome of an applied import: products by what happened, and the prices, pictures and categories it touched. */
export function AppliedSummary({ counts, jobId, written }: { counts: AppliedCounts; jobId: string; written: boolean }) {
  const items: [string, number][] = [
    ["Created", counts.created],
    ["Updated", counts.updated],
    ["Unchanged", counts.unchanged],
    ["Saved as drafts", counts.drafted],
    ["Skipped", counts.skipped],
    ["Failed", counts.failed],
  ];
  const extra: [string, number][] = [
    ["Prices changed", counts.pricesChanged],
    ["Pictures fetched", counts.picturesFetched],
    ["Categories and tags made", counts.termsCreated],
  ];
  return (
    <section aria-label="Result" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">{written ? "What was imported" : "What was imported before it stopped"}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-2xl font-semibold">{wholeNumber(n)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {extra.map(([name, n], i) => (
          <span key={name}>
            {i > 0 ? ", " : ""}
            {name.toLowerCase().replace(/^./, (c) => c.toUpperCase())}: {wholeNumber(n)}
          </span>
        ))}
        .
      </p>
      <p className={hint}>
        Reference for the activity log: <code>{jobId}</code>. A price that changed is in the product&apos;s price history.
      </p>
    </section>
  );
}
