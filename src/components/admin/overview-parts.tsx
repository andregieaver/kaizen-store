import Link from "next/link";
import type { ReactNode } from "react";

/** The pieces the platform's overview and the control center are made of (D107). */

/** A figure with its label; a link when it leads to the page that acts on it. */
export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="text-sm text-muted">{label}</span>
      <span className="text-xl font-semibold tabular-nums [overflow-wrap:anywhere] sm:text-2xl">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </>
  );
  const box = "flex flex-col gap-1 rounded-lg border border-border bg-background p-4";
  return href ? (
    <Link href={href} className={`${box} hover:border-foreground`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export type AttentionItem = { text: ReactNode; href: string; action: string; urgent?: boolean };

/** What needs doing first, each with the page that does it. Says so when there is nothing. */
export function Attention({ items, empty }: { items: AttentionItem[]; empty: string }) {
  return (
    <section aria-labelledby="attention-heading" className="flex flex-col gap-3">
      <h2 id="attention-heading" className="text-lg font-semibold">
        Needs your attention
      </h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
          {items.map((item, index) => (
            <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${item.urgent ? "bg-red-600" : "bg-amber-500"}`} />
              <span className="min-w-0 flex-1">{item.text}</span>
              <Link href={item.href} className="shrink-0 underline">
                {item.action}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
