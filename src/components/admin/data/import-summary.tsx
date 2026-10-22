import { type AppliedCounts, wholeNumber } from "@/lib/data-admin";
import { productsEn, type ProductsMessages } from "@/lib/admin-messages/products.en";

import { card, hint } from "./ui";

/** The numbers of a dry run: what an import would do. */
export function DryRunSummary({
  counts,
  words = productsEn.summary,
  locale = "en-GB",
}: {
  counts: { toCreate: number; toUpdate: number; unchanged: number; withProblems: number };
  /** In the admin's language (D312 A5), English unless given. */
  words?: ProductsMessages["summary"];
  locale?: string;
}) {
  const items: [string, number][] = [
    [words.toCreate, counts.toCreate],
    [words.toUpdate, counts.toUpdate],
    [words.unchanged, counts.unchanged],
    [words.withProblems, counts.withProblems],
  ];
  return (
    <section aria-label={words.found} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{words.found}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-metric text-ink tabular-nums">{wholeNumber(n, locale)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>{words.foundHint}</p>
    </section>
  );
}

/** The outcome of an applied import: products by what happened, and the prices, pictures and categories it touched. */
export function AppliedSummary({
  counts,
  jobId,
  written,
  words = productsEn.summary,
  locale = "en-GB",
}: {
  counts: AppliedCounts;
  jobId: string;
  written: boolean;
  /** In the admin's language (D312 A5), English unless given. */
  words?: ProductsMessages["summary"];
  locale?: string;
}) {
  const items: [string, number][] = [
    [words.created, counts.created],
    [words.updated, counts.updated],
    [words.unchanged, counts.unchanged],
    [words.drafted, counts.drafted],
    [words.skipped, counts.skipped],
    [words.failed, counts.failed],
  ];
  const extra: [string, number][] = [
    [words.pricesChanged, counts.pricesChanged],
    [words.picturesFetched, counts.picturesFetched],
    [words.termsCreated, counts.termsCreated],
  ];
  return (
    <section aria-label={words.result} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{written ? words.imported : words.importedBefore}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-metric text-ink tabular-nums">{wholeNumber(n, locale)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {extra.map(([name, n], i) => (
          <span key={name}>
            {i > 0 ? ", " : ""}
            {name.toLowerCase().replace(/^./, (c) => c.toUpperCase())}: {wholeNumber(n, locale)}
          </span>
        ))}
        .
      </p>
      <p className={hint}>
        {words.reference} <code>{jobId}</code>. {words.priceHistory}
      </p>
    </section>
  );
}
