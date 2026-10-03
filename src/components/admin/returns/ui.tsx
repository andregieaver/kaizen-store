import type { ReactNode } from "react";

import { dueMark, KIND_LABELS, STATUS_LABELS, TONE_CLASS } from "@/lib/return-admin";
import type { ReturnKind, ReturnStatus } from "@/lib/return-status";
import type { RefundDue } from "@/lib/withdrawal";

/** The small pieces the returns screens share: badges, the refund mark and a card. */

export const CARD = "rounded-lg border border-border bg-background p-5";

const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

const STATUS_TONE: Record<ReturnStatus, string> = {
  requested: "border-amber-700 text-amber-800 dark:border-amber-400 dark:text-amber-300",
  approved: "border-border bg-surface",
  in_transit: "border-border bg-surface",
  received: "border-border bg-surface",
  inspected: "border-border bg-surface",
  closed: "border-border text-muted",
  declined: "border-border text-muted",
  cancelled: "border-border text-muted",
};

export function StatusBadge({ status }: { status: ReturnStatus }) {
  return <span className={`${BADGE} ${STATUS_TONE[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function KindBadge({ kind }: { kind: ReturnKind }) {
  return <span className={`${BADGE} border-border text-muted`}>{KIND_LABELS[kind]}</span>;
}

/** What to do about the refund and by when; nothing at all when there is nothing to say. */
export function DueMark({ due, timeZone }: { due: RefundDue; timeZone: string }) {
  const mark = dueMark(due, timeZone);
  if (!mark) return null;
  return <span className={`text-sm ${TONE_CLASS[mark.tone]} ${mark.tone === "urgent" ? "font-medium" : ""}`}>{mark.text}</span>;
}

export function Card({ id, title, children, hint }: { id: string; title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={CARD}>
      <h2 id={id} className="mb-1 font-medium">
        {title}
      </h2>
      {hint && <p className="mb-3 text-sm text-muted">{hint}</p>}
      {children}
    </section>
  );
}

/** A label and its value, for the statement and the sidebar. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-muted sm:w-44">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
