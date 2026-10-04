import type { FormState } from "@/components/admin/action-form";
import { buildPlan, type ErasurePlan } from "@/lib/erasure-plan";
import type { PrivacyCard } from "@/server/privacy-admin";
import type { RequestView } from "@/server/privacy-requests";
import type { RetentionOverview, StoredRule } from "@/server/retention";
import { RETENTION_SEED } from "@/lib/retention";

export const noop = async (): Promise<FormState> => ({ status: "idle", messages: [] });

/** The visible text of rendered HTML: tags dropped, entities read, spaces joined. */
export const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

export const NOW = new Date("2026-10-04T10:00:00Z");

export const request = (over: Partial<RequestView> = {}): RequestView => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "erasure",
  channel: "staff",
  status: "open",
  outcome: null,
  subjectEmail: "kari@example.com",
  subjectCustomerId: null,
  receivedAt: new Date("2026-09-20T00:00:00Z"),
  dueAt: new Date("2026-10-20T00:00:00Z"),
  extendedUntil: null,
  extensionReason: null,
  identityDoubtAt: null,
  completedAt: null,
  refusalReason: null,
  refusalNote: null,
  note: "",
  planSummary: null,
  steps: {},
  handledBy: null,
  createdAt: new Date("2026-09-20T08:00:00Z"),
  daysLeft: 16,
  overdue: false,
  ...over,
});

export const overdue = (over: Partial<RequestView> = {}): RequestView =>
  request({ receivedAt: new Date("2026-08-01T00:00:00Z"), dueAt: new Date("2026-09-01T00:00:00Z"), daysLeft: -33, overdue: true, ...over });

export const card = (over: Partial<PrivacyCard> = {}): PrivacyCard => ({
  subject: { kind: "account", customerId: "22222222-2222-4222-8222-222222222222", email: "kari@example.com" },
  counts: {} as PrivacyCard["counts"],
  countsLine: "3 orders, 2 emails",
  request: null,
  overdue: false,
  language: "en",
  ...over,
});

export const plan = (over: Partial<Parameters<typeof buildPlan>[0]> = {}): ErasurePlan =>
  buildPlan({
    subject: { kind: "account", customerId: "22222222-2222-4222-8222-222222222222", hasEmail: true },
    counts: { customers: 1, wishlists: 2, email_messages: 4 },
    orders: [
      { id: "33333333-3333-4333-8333-333333333333", class: "sale", anchorDay: "2026-03-01", host: false, currency: "EUR", totalMinor: 12_900 },
      { id: "44444444-4444-4444-8444-444444444444", class: "unpaid", anchorDay: "2026-03-01", host: false, currency: "NOK", totalMinor: 5_000 },
    ],
    country: "NO",
    today: "2026-10-04",
    subscriptionsLive: 1,
    savedCards: 1,
    bonus: [{ currency: "NOK", amountMinor: 5_000 }],
    openOrders: 0,
    ordersCancelled: 0,
    openReturns: 0,
    warnings: ["staff_account"],
    ...over,
  });

export const rule = (over: Partial<StoredRule> = {}): StoredRule => ({
  ...RETENTION_SEED[0],
  id: "55555555-5555-4555-8555-555555555555",
  verifiedBy: null,
  createdAt: "2026-10-04T00:00:00.000Z",
  verifiedAt: null,
  ...over,
});

export const overview = (over: Partial<RetentionOverview> = {}): RetentionOverview => ({
  rules: RETENTION_SEED.map((r, i) => ({ ...r, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, verifiedBy: null, createdAt: "2026-10-04T00:00:00.000Z", verifiedAt: r.verifiedAt ?? null })),
  unverified: RETENTION_SEED.length,
  lastRuns: [],
  ...over,
});
