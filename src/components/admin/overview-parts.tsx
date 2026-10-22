import Link from "next/link";
import type { ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import { homeEn, type HomeMessages } from "@/lib/admin-messages/home.en";

import { CARD_CLASS, CountBadge, dotClass } from "./ui";

/**
 * The pieces the platform's overview, the control center and a store's Home are made of (D107), drawn in the admin's components
 * (docs/admin-style.md 5.8): a figure is a KPI tile, what needs doing a card of rows, a section a title over its content.
 */

/** A figure with its label (a KPI tile); a link when it leads to the page that acts on it. */
export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="text-body text-muted">{label}</span>
      <span className="text-metric text-ink tabular-nums [overflow-wrap:anywhere]">{value}</span>
      {sub && <span className="text-caption text-muted">{sub}</span>}
    </>
  );
  const box = `flex flex-col gap-1.5 p-5 ${CARD_CLASS}`;
  return href ? (
    <Link href={href} className={`${box} hover:bg-sunken`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}

export type AttentionItem = { text: ReactNode; href: string; action: string; urgent?: boolean };

/** What needs doing first, each with the page that does it, the urgent ones said so in words too. Says so when there is nothing. */
export function Attention({
  items,
  empty,
  words: w = homeEn.attention,
}: {
  items: AttentionItem[];
  empty: string;
  /** The `home` catalogue's `attention` words in the account's language (D312 A3). */
  words?: Pick<HomeMessages["attention"], "heading" | "toDo" | "urgent">;
}) {
  return (
    <section aria-labelledby="attention-heading" className={`flex flex-col gap-3 p-6 ${CARD_CLASS}`}>
      <div className="flex items-center gap-2">
        <h2 id="attention-heading" className="text-title text-ink">
          {w.heading}
        </h2>
        {items.length > 0 && <CountBadge count={items.length} label={fillWords(w.toDo, { count: items.length })} />}
      </div>
      {items.length === 0 ? (
        <p className="text-body text-muted">{empty}</p>
      ) : (
        <ul role="list" className="divide-y divide-line">
          {items.map((item, index) => (
            <li key={index} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-3 text-body">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotClass(item.urgent ? "danger" : "warning")}`} />
              <span className="min-w-0 flex-1 text-ink">
                {item.urgent && <span className="sr-only">{w.urgent}</span>}
                {item.text}
              </span>
              <Link href={item.href} className="shrink-0 text-body-strong text-ink-2 underline underline-offset-2 hover:text-ink">
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
        <h2 id={id} className="text-title text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
