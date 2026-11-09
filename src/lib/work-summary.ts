import { LONG_TIMER_HOURS, URGENT_OVERDUE_DAYS } from "./work-overview";
import type { CombinedOverview, WorkStore } from "./work-owner";
import { WORK_ROOT, workBase } from "./work-paths";

/**
 * Work across a person's stores, for another app to show (docs/life-work-summary.md 3.1): Kaizen Life's Today card,
 * its Work page and its assistant read this, and every line opens the exact Kaizena Flow screen. It is data, not
 * sentences: the reading app words it in its own languages, and money stays per currency, never added across
 * currencies (integer minor units, as everywhere in Work). Every link is built here with `workBase()` and passed
 * through the handoff door, so the other app never builds a Kaizena Flow address.
 */
export type WorkSummaryMoney = { minor: number; currency: string };

export type WorkSummaryNeedKind = "overdue" | "timer" | "unbilled" | "recurring_ready" | "drafts_waiting";

export type WorkSummaryNeed = {
  kind: WorkSummaryNeedKind;
  /** An invoice overdue 14 days or more, or a timer running 12 hours or more (`workAttention()`'s rules). */
  urgent: boolean;
  /** The store the line is about; null when it covers several. */
  store: { slug: string; name: string } | null;
  count?: number;
  money?: WorkSummaryMoney;
  minutes?: number;
  /** The oldest due date, the timer's start or the oldest unbilled day. */
  since?: string;
  /** Only on a line about one client (the person's timer, a single overdue invoice); never a list of names. */
  client?: string;
  task?: string;
  href: string;
};

export type WorkSummaryCurrency = {
  currency: string;
  /** Owed on issued invoices, overdue included. */
  onItsWay: number;
  overdue: number;
  dueSoon: number;
  paidThisMonth: number;
  drafts: { count: number; minor: number };
  unbilled: { minutes: number; minor: number };
};

export type WorkSummaryStore = {
  slug: string;
  name: string;
  workOn: boolean;
  href: string;
  currencies: WorkSummaryCurrency[];
  unbilledMinutes: number;
};

export type WorkSummary = {
  /** When the figures were read (ISO). */
  asOf: string;
  /** Some store the person can read uses Work. */
  workOn: boolean;
  /** The combined Work view. */
  open: string;
  /** Where to switch Work on, when no store uses it and the person owns one that could. */
  turnOn: string | null;
  /** What needs the person, urgent first; empty when nothing does. */
  needs: WorkSummaryNeed[];
  currencies: WorkSummaryCurrency[];
  stores: WorkSummaryStore[];
};

/** The person's own running timer, as the summary needs it (`getRunningTimer()`). */
export type SummaryTimer = {
  storeSlug: string;
  storeName: string;
  clientName: string;
  taskTitle: string | null;
  startedAt: string;
  elapsedSeconds: number;
};

export type SummaryInput = {
  stores: { using: readonly WorkStore[]; off: readonly WorkStore[] };
  combined: CombinedOverview;
  clientNames: Readonly<Record<string, string>>;
  timer: SummaryTimer | null;
  now: Date;
  /** Wraps a Kaizena Flow path (`/admin/…`) into the absolute address the other app links to. */
  door: (path: string) => string;
};

const KIND_ORDER: readonly WorkSummaryNeedKind[] = ["overdue", "timer", "unbilled", "recurring_ready", "drafts_waiting"];

/** The handoff door's address for a path in the admin (docs/life-work-summary.md 3.5). */
export function kaizenLifeDoor(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}/admin/sign-in/kaizen-life?next=${encodeURIComponent(path)}`;
}

const storeRef = (slugs: ReadonlySet<string>, names: ReadonlyMap<string, string>) => {
  if (slugs.size !== 1) return null;
  const [slug] = [...slugs];
  return { slug, name: names.get(slug) ?? slug };
};

/** One store's page or the combined one: `path` is the part after the Work base (`/invoices?show=overdue`). */
const placeFor = (slugs: ReadonlySet<string>, path: string) =>
  slugs.size === 1 ? `${workBase([...slugs][0])}${path}` : `${WORK_ROOT}${path}`;

export function workSummaryOf(input: SummaryInput): WorkSummary {
  const { stores, combined, clientNames, timer, now, door } = input;
  const names = new Map<string, string>();
  for (const s of [...stores.using, ...stores.off]) names.set(s.slug, s.name);
  const needs: WorkSummaryNeed[] = [];

  // Overdue invoices: one line per currency, the oldest first within it.
  const overdueByCurrency = new Map<string, CombinedOverview["overdueInvoices"]>();
  for (const row of combined.overdueInvoices) {
    const list = overdueByCurrency.get(row.currency) ?? [];
    list.push(row);
    overdueByCurrency.set(row.currency, list);
  }
  for (const [currency, rows] of [...overdueByCurrency].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const slugs = new Set(rows.map((r) => r.storeSlug));
    const oldest = rows.reduce((min, r) => (r.dueOn < min ? r.dueOn : min), rows[0].dueOn);
    const minor = rows.reduce((sum, r) => sum + r.outstandingMinor, 0);
    needs.push({
      kind: "overdue",
      urgent: rows.some((r) => r.daysOverdue >= URGENT_OVERDUE_DAYS),
      store: storeRef(slugs, names),
      count: rows.length,
      money: { minor, currency },
      since: oldest,
      ...(rows.length === 1 && clientNames[rows[0].clientId] ? { client: clientNames[rows[0].clientId] } : {}),
      href: door(placeFor(slugs, "/invoices?show=overdue")),
    });
  }

  // The person's own timer.
  if (timer) {
    const minutes = Math.floor(Math.max(0, timer.elapsedSeconds) / 60);
    needs.push({
      kind: "timer",
      urgent: minutes >= LONG_TIMER_HOURS * 60,
      store: { slug: timer.storeSlug, name: timer.storeName },
      minutes,
      since: timer.startedAt,
      client: timer.clientName,
      ...(timer.taskTitle ? { task: timer.taskTitle } : {}),
      href: door(workBase(timer.storeSlug)),
    });
  }

  // Time ready to invoice: one line per currency.
  for (const figures of combined.currencies) {
    if (figures.unbilled.minutes <= 0) continue;
    const slugs = new Set(
      combined.perStore
        .filter((p) => p.currencies.some((c) => c.currency === figures.currency && c.unbilled.minutes > 0))
        .map((p) => p.store.slug),
    );
    needs.push({
      kind: "unbilled",
      urgent: false,
      store: storeRef(slugs, names),
      minutes: figures.unbilled.minutes,
      money: { minor: figures.unbilled.amountMinor, currency: figures.currency },
      ...(figures.unbilled.oldestWorkDate ? { since: figures.unbilled.oldestWorkDate } : {}),
      href: door(placeFor(slugs, "")),
    });
  }

  // Repeating invoices whose drafts are ready, and drafts left waiting a week or more.
  const counted = (key: "recurringReady" | "staleDrafts", kind: WorkSummaryNeedKind) => {
    const parts = combined.perStore.filter((p) => p.counts[key] > 0);
    if (parts.length === 0) return;
    const slugs = new Set(parts.map((p) => p.store.slug));
    needs.push({
      kind,
      urgent: false,
      store: storeRef(slugs, names),
      count: parts.reduce((sum, p) => sum + p.counts[key], 0),
      href: door(placeFor(slugs, "/invoices?show=drafts")),
    });
  };
  counted("recurringReady", "recurring_ready");
  counted("staleDrafts", "drafts_waiting");

  needs.sort(
    (a, b) => Number(b.urgent) - Number(a.urgent) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );

  const currencyOf = (f: CombinedOverview["currencies"][number]): WorkSummaryCurrency => ({
    currency: f.currency,
    onItsWay: f.receivables.outstandingMinor,
    overdue: f.receivables.overdue.minor,
    dueSoon: f.receivables.dueSoon.minor,
    paidThisMonth: f.paidThisMonth.minor,
    drafts: { count: f.drafts.count, minor: f.drafts.minor },
    unbilled: { minutes: f.unbilled.minutes, minor: f.unbilled.amountMinor },
  });

  const perStore = new Map(combined.perStore.map((p) => [p.store.slug, p]));
  const storeRows: WorkSummaryStore[] = [
    ...stores.using.map((s) => {
      const part = perStore.get(s.slug);
      return {
        slug: s.slug,
        name: s.name,
        workOn: true,
        href: door(workBase(s.slug)),
        currencies: (part?.currencies ?? []).map(currencyOf),
        unbilledMinutes: part?.unbilledMinutes ?? 0,
      };
    }),
    ...stores.off.map((s) => ({
      slug: s.slug,
      name: s.name,
      workOn: false,
      href: door(`${WORK_ROOT}/settings`),
      currencies: [],
      unbilledMinutes: 0,
    })),
  ];

  const workOn = stores.using.length > 0;
  return {
    asOf: now.toISOString(),
    workOn,
    open: door(WORK_ROOT),
    turnOn: !workOn && stores.off.length > 0 ? door(`${WORK_ROOT}/settings`) : null,
    needs: workOn ? needs : [],
    currencies: workOn ? combined.currencies.map(currencyOf) : [],
    stores: storeRows,
  };
}
