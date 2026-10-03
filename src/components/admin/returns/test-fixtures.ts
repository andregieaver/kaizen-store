import { actionsFor, timeline, type ReturnAction } from "@/lib/return-status";
import { DEFAULT_RETURN_SETTINGS, type RefundDue } from "@/lib/withdrawal";
import type { RefundPreviewData } from "@/lib/return-admin";
import type { DetailLine, QueueRow, ReturnDetail } from "@/server/returns";

import type { ReturnDetailActions } from "./detail-view";

/** What the returns screens' tests draw: a return, a queue row and the actions as do-nothings, so a screen can be seen without a server. */

const NOW = "2026-10-05T10:00:00.000Z";

export const line = (over: Partial<DetailLine> = {}): DetailLine => ({
  lineId: "11111111-1111-4111-8111-111111111111",
  title: "White mug",
  sku: "MUG-WHITE",
  orderedQuantity: 2,
  quantity: 2,
  decision: "accept",
  declineReason: null,
  condition: null,
  restock: false,
  deductionMinor: 0,
  deductionNote: null,
  reason: null,
  unitPriceMinor: 15_000,
  totalMinor: 30_000,
  delivery: "physical",
  withdrawalExclusion: "none",
  valueMinor: 30_000,
  ...over,
});

const noDue: RefundDue = { state: "waiting", deadline: new Date("2026-10-19T10:00:00.000Z"), daysToDeadline: 14, waitingFor: "goods", clockStart: null };

export function detail(over: Partial<ReturnDetail> = {}): ReturnDetail {
  const base: ReturnDetail = {
    id: "22222222-2222-4222-8222-222222222222",
    number: "1001-R1",
    kind: "withdrawal",
    status: "approved",
    orderId: "33333333-3333-4333-8333-333333333333",
    orderNumber: "1001",
    orderEmail: "kari@example.com",
    currency: "NOK",
    createdAt: NOW,
    approvedAt: NOW,
    shippedAt: null,
    receivedAt: null,
    inspectedAt: null,
    closedAt: null,
    outcome: null,
    reason: null,
    reasonNote: null,
    instructions: "Pack it well.",
    labelUrl: null,
    returnAddress: { name: "Returns", street: "Lager 1", postalCode: "0150", city: "Oslo", country: "NO" },
    decisionNote: null,
    staffNote: null,
    publicToken: "token",
    refundDeadline: "2026-10-19T10:00:00.000Z",
    refund: { recorded: false, amountMinor: null, computedMinor: null, note: null, at: null, outside: false, refundId: null, returnShippingMinor: 0 },
    request: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Kari Nordmann",
      email: "kari@example.com",
      submittedAt: NOW,
      confirmedAt: NOW,
      acknowledgedAt: NOW,
      acknowledgementReference: "ack-1",
      acknowledgement: "sent",
    },
    lines: [line()],
    steps: timeline("withdrawal", "approved"),
    events: [
      { type: "return.confirmed", at: NOW, actor: "shopper", data: { returnId: "22222222-2222-4222-8222-222222222222", number: "1001-R1" } },
      { type: "return.approved", at: NOW, actor: "system", data: { automatic: true } },
    ],
    actions: [],
    due: noDue,
    working: null,
    order: { status: "paid", canRefund: true, paidMinor: 35_000, refundedMinor: 0, refundableMinor: 35_000, subscription: false, business: false },
    nothingSent: false,
    whoPaysReturn: "shopper",
    settings: { ...DEFAULT_RETURN_SETTINGS },
  };
  const merged = { ...base, ...over };
  return {
    ...merged,
    steps: over.steps ?? timeline(merged.kind, merged.status),
    actions:
      over.actions ??
      actionsFor({
        kind: merged.kind,
        status: merged.status,
        refunded: merged.refund.recorded,
        refundWhen: merged.settings.refundWhen,
        acknowledgementPending: merged.request?.acknowledgement === "not_sent",
        nothingToSendBack: merged.nothingSent,
      }),
  };
}

export const row = (over: Partial<QueueRow> = {}): QueueRow => ({
  id: "22222222-2222-4222-8222-222222222222",
  number: "1001-R1",
  kind: "withdrawal",
  status: "approved",
  orderId: "33333333-3333-4333-8333-333333333333",
  orderNumber: "1001",
  email: "kari@example.com",
  name: "Kari Nordmann",
  currency: "NOK",
  units: 2,
  createdAt: NOW,
  refundMinor: null,
  due: noDue,
  overdue: false,
  acknowledgementPending: false,
  ...over,
});

export const preview = (over: Partial<RefundPreviewData> = {}): RefundPreviewData => ({
  amountMinor: 35_000,
  working: [
    { key: "goods", amountMinor: 30_000 },
    { key: "shipping", amountMinor: 5_000 },
  ],
  cappedBy: null,
  wholeOrder: true,
  refundableMinor: 35_000,
  canRefund: true,
  returnShippingMinor: 0,
  ...over,
});

const none = async () => ({ status: "idle" as const, messages: [] });
export const actions: ReturnDetailActions = {
  approve: none,
  decline: none,
  declineLine: none,
  instructions: none,
  markInTransit: none,
  markReceived: none,
  inspect: none,
  refund: none,
  close: none,
  cancel: none,
  note: none,
  acknowledge: none,
  recalculate: async () => ({ ok: true, preview: preview() }),
};

export type { ReturnAction };

/** What a person reads: scripts and comment markers gone, entities and no-break spaces made plain. */
export const plain = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ");
