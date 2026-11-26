import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";

import { StatusPill, type PillTone } from "./analytics/data-table";
import { EmptyState } from "./ui/empty-state";

/**
 * Prices kept by hand with the page each stands on, and what code last found there (`priceOnPage()`): other platforms' plan prices on
 * Platform → Plans (D900 M4) and rivals' service prices on Analytics → Markets (D905 M5d). Each row says the price, its page's state, the
 * details its card works out, its page and *Remove*; keeping one is a step in, open while none is kept, its fields the card's own. Drawn on
 * the server; the forms post to the card's actions.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type KeptPriceRow = {
  id: string;
  /** What the row is named by in tests and the screen reader's *Remove*. */
  name: string;
  price: string;
  onPage: boolean | null;
  goneAt: string | null;
  /** The card's own words under the price: what it is held against, when it was checked. */
  details: string;
  source: string;
};

export type KeptPriceWords = {
  none: string;
  gone: string;
  unread: string;
  onPage: string;
  notFound: string;
  page: string;
  remove: string;
  removed: string;
  addTitle: string;
  keep: string;
};

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

/** What code last found on a price's page, and its pill's tone. */
function pageState(row: KeptPriceRow, w: KeptPriceWords): [string, PillTone] {
  if (row.goneAt) return [w.gone, "bad"];
  if (row.onPage === null) return [w.unread, "neutral"];
  return row.onPage ? [w.onPage, "good"] : [w.notFound, "warning"];
}

export function KeptPrices({
  rows,
  w,
  dataName,
  remove,
  keep,
  children,
}: {
  rows: readonly KeptPriceRow[];
  w: KeptPriceWords;
  /** The attribute each row carries its name in (`data-platform-price`). */
  dataName: `data-${string}`;
  /** Null for a member who may only read; `keep` is also null when there is nothing to keep a price of. */
  remove: Action | null;
  keep: Action | null;
  /** The keeping form's fields. */
  children: ReactNode;
}) {
  return (
    <>
      {rows.length === 0 ? (
        <EmptyState compact title={w.none} />
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {rows.map((row) => {
            const [state, tone] = pageState(row, w);
            return (
              <li key={row.id} {...{ [dataName]: row.name }} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-body-strong text-ink">{row.name}</span>
                  <span className="tabular-nums text-ink">{row.price}</span>
                  <StatusPill tone={tone}>{state}</StatusPill>
                </span>
                <span className="text-muted">{row.details}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a href={row.source} target="_blank" rel="noopener noreferrer nofollow" className={linkClass}>
                    {w.page}
                  </a>
                  {remove ? (
                    <ActionForm action={remove} successMessage={w.removed}>
                      <input type="hidden" name="price" value={row.id} />
                      <SubmitButton variant="secondary">
                        {w.remove}
                        <span className="sr-only">{` ${row.name}`}</span>
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {keep ? (
        <details open={rows.length === 0} className="flex flex-col gap-3">
          <summary className="cursor-pointer select-none text-body-strong text-ink">{w.addTitle}</summary>
          <ActionForm action={keep} replaceOnSuccess className="mt-3 grid gap-3 sm:grid-cols-2">
            {children}
            <div className="sm:col-span-2">
              <SubmitButton>{w.keep}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      ) : null}
    </>
  );
}
