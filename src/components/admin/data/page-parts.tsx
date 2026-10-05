import Link from "next/link";
import type { ReactNode } from "react";

import { card, hint } from "./ui";

/** The head of a data page: where it sits (a link back to the list it belongs to), its title and what it is for. Full width, like the other admin pages. */
export function DataPageHead({ backHref, backLabel, title, intro }: { backHref: string; backLabel: string; title: string; intro: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <Link href={backHref} className="text-sm text-muted underline underline-offset-2">
        {backLabel}
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-3xl text-sm text-muted">{intro}</p>
    </header>
  );
}

/** A plain notice on a data page (a limit, a warning about personal data): a titled card, never a fixed colour. */
export function Notice({ title, children, tone = "plain" }: { title?: string; children: ReactNode; tone?: "plain" | "warning" }) {
  return (
    <aside className={`${card} flex flex-col gap-1 ${tone === "warning" ? "border-foreground" : ""}`} role={tone === "warning" ? "note" : undefined}>
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      <div className="text-sm">{children}</div>
    </aside>
  );
}

/** What the page says when a request came back with a problem code: the fixed sentence the page chose, in an alert. */
export function ProblemAlert({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-lg border border-border bg-surface p-3 text-sm text-red-700 dark:text-red-400">
      {text}
    </p>
  );
}

export function SkeletonBlock({ height = "h-40" }: { height?: string }) {
  return <div className={`${height} animate-pulse rounded-lg bg-background`} />;
}

/** The loading state of every data page: a heading's worth and two blocks. */
export function DataSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-background" />
      <SkeletonBlock height="h-16" />
      <SkeletonBlock />
      <p className={`${hint} sr-only`}>Loading</p>
    </div>
  );
}
