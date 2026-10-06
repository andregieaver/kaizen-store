import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { DraftScreen } from "@/components/admin/drafts/draft-screen";
import { db } from "@/db/client";
import { draftMarketOptions } from "@/lib/draft-markets";
import { DRAFT_STATUS_LABELS } from "@/lib/draft-status";
import { sql } from "drizzle-orm";
import { draftProblemText } from "@/lib/draft-order";
import { getOrderSettings, mayRecordOutsidePayment } from "@/server/order-settings";
import { previewDraft } from "@/server/draft-orders";
import { mayFindDraftCustomers, memberCan, requirePermission } from "@/server/permissions";
import { listVatCategories } from "@/server/vat-categories";

import {
  deleteDraftAction,
  draftCustomerDetailsAction,
  recordPaidOutsideAction,
  reopenDraftAction,
  resendDraftLinkAction,
  saveDraftAction,
  searchDraftCustomersAction,
  searchDraftVariantsAction,
  sendDraftAction,
} from "../actions";

export const metadata: Metadata = { title: "Draft order" };

type Props = PageProps<"/admin/[store]/orders/drafts/[draftId]">;

/**
 * One draft order (wave 3, D173, `docs/wave-3-orders.md` 2.4): the editor while it is open, a read-only page once it is sent, paid, expired or cancelled. `orders:read` to look, `orders:write` to edit, send and reopen; recording
 * a payment taken outside Kaizen is the owner's (or staff's when the owner allows it, checked by the server). Everything shown about the totals is worked out by the server from what it saved.
 */
export default async function DraftPage({ params }: Props) {
  const { store: slug, draftId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(draftId).success) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-background" />}>
        <Body storeSlug={store.slug} draftId={draftId} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, draftId }: { storeSlug: string; draftId: string }) {
  const member = await requirePermission(storeSlug, "orders:read");
  const { store } = member;
  const [preview, settings, categories, mayRecordOutside] = await Promise.all([
    previewDraft(store.id, draftId),
    getOrderSettings(store.id),
    listVatCategories(),
    mayRecordOutsidePayment(member),
  ]);
  if (!preview) notFound();
  const { draft } = preview;
  const [order] = draft.orderId
    ? await db().execute<Record<string, unknown>>(sql`select number from commerce.orders where store_id = ${store.id}::uuid and id = ${draft.orderId}::uuid`)
    : [];
  const canWrite = memberCan(member, "orders:write");
  const currency = preview.market?.currency ?? draft.currency;
  const locale = preview.market?.locale ?? draft.locale;
  const problems = preview.problems.map((p) => ({ code: p.code, key: p.key ?? null, blocking: p.blocking, text: draftProblemText(p.code) }));
  const base = `/admin/${store.slug}/orders/drafts`;
  return (
    <>
      <div>
        <Link href={base} className="text-sm text-muted underline underline-offset-2">
          Draft orders
        </Link>
        <h1 className="text-2xl font-semibold">
          Draft {draft.number} <span className="text-base font-normal text-muted">· {DRAFT_STATUS_LABELS[draft.status].toLowerCase()}</span>
        </h1>
      </div>
      <DraftScreen
        editable={draft.status === "open" && canWrite}
        editor={{
          number: draft.number,
          initial: draft,
          version: draft.version,
          currency,
          locale,
          initialSummary: preview.summary,
          initialProblems: problems,
          marketOptions: draftMarketOptions(store.markets, store.localization),
          categories: categories.filter((c) => c.active).map((c) => ({ code: c.code, name: c.nameEn })),
          defaultDays: settings.draftValidDays,
          mayRecordOutside,
          mayFindCustomers: mayFindDraftCustomers(member),
          actions: {
            save: saveDraftAction.bind(null, store.slug, draftId),
            searchVariants: searchDraftVariantsAction.bind(null, store.slug),
            searchCustomers: searchDraftCustomersAction.bind(null, store.slug),
            customerDetails: draftCustomerDetailsAction.bind(null, store.slug),
            send: sendDraftAction.bind(null, store.slug, draftId),
            paidOutside: recordPaidOutsideAction.bind(null, store.slug, draftId),
            remove: deleteDraftAction.bind(null, store.slug, draftId),
          },
        }}
        sent={{
          slug: store.slug,
          number: draft.number,
          status: draft.status,
          draft,
          version: draft.version,
          orderId: draft.orderId,
          orderNumber: order ? String(order.number) : null,
          expiresAt: draft.expiresAt,
          linkRanOut: draft.expiresAt !== null && new Date(draft.expiresAt).getTime() <= new Date().getTime(),
          linkLive: draft.linkLive,
          paySendsToday: draft.paySendsToday,
          summary: preview.summary,
          problems,
          currency,
          locale,
          timeZone: store.timeZone,
          canWrite,
          mayRecordOutside,
        }}
        sentActions={{
          resend: resendDraftLinkAction.bind(null, store.slug, draftId),
          reopen: reopenDraftAction.bind(null, store.slug, draftId),
          remove: deleteDraftAction.bind(null, store.slug, draftId),
          paidOutside: recordPaidOutsideAction.bind(null, store.slug, draftId),
        }}
      />
    </>
  );
}
