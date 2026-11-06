import { z } from "zod";

import { convertMinor, type Rates } from "./currency";
import { parsePrice } from "./product-input";

/**
 * Deals and pipelines (S2 of `docs/own-books-and-sales.md`, D464), pure: what a deal is, the stages a store starts with, what staff may
 * type, and the figures the board shows. A deal exists before any quote ("met them at the fair"): a title, a person or a company, the staff
 * member who owns it, a pipeline and a stage, an expected close date and an estimate while nothing is linked. Once a quote, an order or a
 * Work assignment is linked, its value is theirs, never the estimate's (one truth): `dealValue()` is the only place that adds it up, in the
 * store's main currency, saying what it could not convert. Nothing here knows a database.
 */

export const DEAL_STATUSES = ["open", "won", "lost"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** What a deal can be linked to: an order, a draft order (a quote) or a Work assignment. One thing belongs to one deal. */
export const DEAL_LINK_KINDS = ["order", "draft", "work_assignment"] as const;
export type DealLinkKind = (typeof DEAL_LINK_KINDS)[number];

/** How a deal was closed: by a person, or won by a paid order or an issued Work invoice linked to it. */
export const DEAL_CLOSED_VIA = ["person", "order", "work_invoice"] as const;
export type DealClosedVia = (typeof DEAL_CLOSED_VIA)[number];

export const DEAL_TITLE_MAX = 200;
export const DEAL_REASON_MAX = 200;
export const PIPELINE_NAME_MAX = 80;
export const STAGE_NAME_MAX = 60;
export const MAX_STAGES = 12;
export const MAX_PIPELINES = 20;
/** The largest estimate, in minor units: ten billion in a two-decimal currency. */
export const ESTIMATE_MAX_MINOR = 1_000_000_000_000;

/** The stages a store's first pipeline starts with, for Homer: names by key in the catalogue; won and lost are a deal's status, not stages. */
export const DEFAULT_STAGES = ["new", "talking", "quote_sent"] as const;
export type DefaultStage = (typeof DEFAULT_STAGES)[number];

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.uuid();

/** A deal as a person types it: an estimate in major units ("12 500"), parsed in the store's main currency. */
export type DealInput = {
  title: string;
  customerId: string | null;
  companyId: string | null;
  ownerId: string | null;
  pipelineId: string;
  stageId: string;
  estimateMinor: number | null;
  expectedCloseOn: string | null;
};

export type DealInputProblem = "title" | "who" | "pipeline" | "stage" | "estimate" | "expected_close" | "owner";

const blank = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** What a person typed, checked: a title, a person or a company (at least one), a stage of the pipeline, an estimate that is an amount. */
export function cleanDealInput(raw: Record<string, unknown>, currency: string): { ok: true; deal: DealInput } | { ok: false; problems: DealInputProblem[] } {
  const problems: DealInputProblem[] = [];
  const title = trimmed(DEAL_TITLE_MAX).safeParse(raw.title);
  if (!title.success) problems.push("title");
  const id = (value: unknown) => (blank(value) ? (uuid.safeParse(blank(value)).success ? blank(value) : undefined) : null);
  const customerId = id(raw.customerId);
  const companyId = id(raw.companyId);
  if (customerId === undefined || companyId === undefined || (!customerId && !companyId)) problems.push("who");
  const ownerId = id(raw.ownerId);
  if (ownerId === undefined) problems.push("owner");
  const pipelineId = id(raw.pipelineId);
  if (!pipelineId) problems.push("pipeline");
  const stageId = id(raw.stageId);
  if (!stageId) problems.push("stage");
  let estimateMinor: number | null = null;
  if (blank(raw.estimate)) {
    const parsed = parsePrice(blank(raw.estimate), currency);
    if (parsed === null || parsed < 0 || parsed > ESTIMATE_MAX_MINOR) problems.push("estimate");
    else estimateMinor = parsed;
  }
  let expectedCloseOn: string | null = null;
  if (blank(raw.expectedCloseOn)) {
    if (!dateText.safeParse(blank(raw.expectedCloseOn)).success || Number.isNaN(Date.parse(`${blank(raw.expectedCloseOn)}T00:00:00Z`))) problems.push("expected_close");
    else expectedCloseOn = blank(raw.expectedCloseOn);
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    deal: {
      title: title.data as string,
      customerId: customerId ?? null,
      companyId: companyId ?? null,
      ownerId: ownerId ?? null,
      pipelineId: pipelineId as string,
      stageId: stageId as string,
      estimateMinor,
      expectedCloseOn,
    },
  };
}

/** A reason a deal was lost, as typed: trimmed, at most 200 characters, or none. */
export function cleanReason(raw: unknown): string | null {
  const text = blank(raw).replace(/\s+/g, " ");
  return text ? text.slice(0, DEAL_REASON_MAX) : null;
}

/** One linked thing's amount, as the server read it: an order's total, a quote's, an assignment's invoiced or agreed amount. */
export type LinkValue = { kind: DealLinkKind; minor: number; currency: string };

export type DealValue = {
  /** In the store's main currency; null when nothing could be counted. */
  minor: number | null;
  /** Where it came from: the linked things, the estimate, or nothing yet. */
  source: "links" | "estimate" | "none";
  /** Currencies of linked things with no rate to the main currency: left out, never counted as zero. */
  unconverted: string[];
};

/** A deal's value, the one place it is worked out: the linked things' amounts when there are any, else the estimate. */
export function dealValue(estimate: { minor: number | null; currency: string }, links: readonly LinkValue[], mainCurrency: string, rates: Rates): DealValue {
  if (links.length > 0) {
    let minor = 0;
    let counted = 0;
    const unconverted = new Set<string>();
    for (const link of links) {
      const converted = link.currency === mainCurrency ? link.minor : convertMinor(link.minor, link.currency, mainCurrency, rates);
      if (converted === null) unconverted.add(link.currency);
      else {
        minor += converted;
        counted++;
      }
    }
    return { minor: counted > 0 ? minor : null, source: "links", unconverted: [...unconverted].sort() };
  }
  if (estimate.minor === null) return { minor: null, source: "none", unconverted: [] };
  if (estimate.currency === mainCurrency) return { minor: estimate.minor, source: "estimate", unconverted: [] };
  const converted = convertMinor(estimate.minor, estimate.currency, mainCurrency, rates);
  return converted === null ? { minor: null, source: "estimate", unconverted: [estimate.currency] } : { minor: converted, source: "estimate", unconverted: [] };
}

/** A value weighted by its stage's probability (Lisa's forecast): rounded to the minor unit; the value itself where the stage has none. */
export function weighted(minor: number, probability: number | null): number {
  if (probability === null) return minor;
  return Math.round((minor * Math.max(0, Math.min(100, probability))) / 100);
}

/** Whole days a deal has sat in its stage, never negative. */
export function daysInStage(enteredAt: string, now: Date): number {
  const ms = now.getTime() - new Date(enteredAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

export type BoardStage = { id: string; name: string; probability: number | null };
export type BoardDeal = { id: string; stageId: string; status: DealStatus; value: number | null; expectedCloseOn: string | null; createdAt: string };
export type BoardColumn<D extends BoardDeal> = { key: string; stage: BoardStage | null; status: DealStatus; deals: D[]; total: number; weightedTotal: number };

/**
 * The board: a column per stage of the pipeline in its order with its open deals, then Won and Lost. Within a column the deal expected to
 * close first comes first, then the oldest; a deal with no value adds nothing to the totals. A deal in a stage the pipeline no longer has is
 * left out (the server moves deals before a stage is deleted).
 */
export function boardColumns<D extends BoardDeal>(stages: readonly BoardStage[], deals: readonly D[]): BoardColumn<D>[] {
  const order = (a: D, b: D) =>
    (a.expectedCloseOn ?? "9999-12-31").localeCompare(b.expectedCloseOn ?? "9999-12-31") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const column = (key: string, stage: BoardStage | null, status: DealStatus, list: D[]): BoardColumn<D> => {
    const sorted = [...list].sort(order);
    const total = sorted.reduce((s, d) => s + (d.value ?? 0), 0);
    const weightedTotal = sorted.reduce((s, d) => s + weighted(d.value ?? 0, status === "open" ? (stage?.probability ?? null) : null), 0);
    return { key, stage, status, deals: sorted, total, weightedTotal };
  };
  return [
    ...stages.map((stage) => column(stage.id, stage, "open", deals.filter((d) => d.status === "open" && d.stageId === stage.id))),
    column("won", null, "won", deals.filter((d) => d.status === "won")),
    column("lost", null, "lost", deals.filter((d) => d.status === "lost")),
  ];
}
