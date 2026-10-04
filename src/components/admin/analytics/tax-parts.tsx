import Link from "next/link";
import type { ReactNode } from "react";

import { TAX_VIEWS, TAX_VIEW_LABEL, type ExportFormKind, type TaxViewId } from "@/lib/tax-admin";

import { Note } from "./section";

/**
 * Small parts the VAT, OSS and IOSS views share (D161, `docs/wave-1c-reports.md` 2.2): the always-visible statement that these figures are
 * not a tax return, the tabs between the three views, and an export button, which is a POST form to the export route (never a link: an
 * export is written to the activity log, so a crawler or a prefetch must not be able to make one). Server components in the admin's
 * tokens. Nothing here reads the database or sets a cookie.
 */

/** The line every view starts with and every file carries: whose figures these are, and what they are not. */
export const NOT_A_RETURN = "These are your own figures, made from your invoices and credit notes, for you and your accountant. They are not a tax return and Kaizen files nothing.";

export function TaxStatement({ children }: { children?: ReactNode }) {
  return (
    <Note tone="warning" title="Not a tax return">
      <p>{NOT_A_RETURN}</p>
      {children}
    </Note>
  );
}

/** The three views as tabs: links, so each is an address of its own. */
export function TaxViewTabs({ current, hrefs }: { current: TaxViewId; hrefs: Record<TaxViewId, string> }) {
  return (
    <nav aria-label="Report" className="flex flex-wrap gap-1">
      {TAX_VIEWS.map((id) => (
        <Link
          key={id}
          href={hrefs[id]}
          aria-current={id === current ? "page" : undefined}
          className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm ${id === current ? "border-foreground bg-surface font-semibold" : "border-border"}`}
        >
          {TAX_VIEW_LABEL[id]}
        </Link>
      ))}
    </nav>
  );
}

export type ExportFields = Readonly<Record<string, string>>;

/**
 * One export: a small POST form to `{base}/analytics/tax/export` with the kind and what it is for as hidden fields. `disabled` (with a
 * reason beside it) keeps the button but not the press; the route refuses the same cases itself, so this is only kindness.
 */
export function ExportButton({ base, kind, fields, children, disabled = false, primary = false }: { base: string; kind: ExportFormKind; fields: ExportFields; children: ReactNode; disabled?: boolean; primary?: boolean }) {
  return (
    <form method="post" action={`${base}/analytics/tax/export`} className="inline-flex">
      <input type="hidden" name="kind" value={kind} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={disabled}
        className={primary ? "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40" : "min-h-10 rounded-md border border-border bg-background px-4 text-sm disabled:opacity-40"}
      >
        {children}
      </button>
    </form>
  );
}

/** What a member who may only read sees in place of the export buttons. */
export function ExportsNeedWrite() {
  return <p className="text-sm text-muted">Exports need the analytics role with write access.</p>;
}
