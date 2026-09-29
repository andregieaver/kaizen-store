import Link from "next/link";
import type { ReactNode } from "react";

import { PrintButton } from "@/components/admin/work/print-button";

/**
 * The frame of a Work document's print page (docs/work.md 4.7): no admin
 * header, menu or assistant (the print routes sit in their own route group,
 * `admin/(gated)/(print)`), just a small toolbar that is left out of the
 * print, over the document on a grey desk. The document brings its own
 * styles, black on white whatever the colour mode.
 */
export function DocumentPage({
  backHref,
  backLabel,
  documentTitle,
  auto,
  children,
}: {
  backHref: string;
  backLabel: string;
  documentTitle: string;
  auto: boolean;
  children: ReactNode;
}) {
  return (
    <main className="wd-screen bg-[#f3f4f6] text-black">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="inline-flex min-h-10 items-center text-sm text-black underline">
          {backLabel}
        </Link>
        <PrintButton label="Print or save as PDF" documentTitle={documentTitle} auto={auto} />
      </div>
      {children}
    </main>
  );
}

/** What the print page says when there is nothing to print, in the admin's own English. */
export function NoDocument({
  title,
  message,
  href,
  linkLabel,
}: {
  title: string;
  message: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="rounded-lg border border-border bg-background p-5 text-sm">{message}</p>
      <Link href={href} className="text-sm underline">
        {linkLabel}
      </Link>
    </main>
  );
}
