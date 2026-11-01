import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { DisputeEvidenceForm } from "@/components/admin/orders/dispute-evidence-form";
import { CARD_CLASS, Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { disputeDashboardUrl, disputeReasonWords, dueWords } from "@/lib/payment-facts";
import { disputeEvidence } from "@/server/dispute-evidence";
import { memberCan, requirePermission } from "@/server/permissions";

import { saveEvidenceAction } from "./actions";

export const metadata: Metadata = { title: "Answer the dispute" };

/**
 * The chargeback assistant (D417): a dispute's evidence drafted from the order, for the owner to read, change and send to Stripe. Staff who can read
 * orders see it; only `orders:write` can save or send, and sending needs the tick. A Mollie chargeback, a closed dispute or one already answered
 * shows what stands, with nothing to press.
 */
export default async function DisputeEvidencePage({ params }: PageProps<"/admin/[store]/orders/[orderId]/dispute/[disputeId]">) {
  const { store: slug, orderId, disputeId } = await params;
  const member = await requirePermission(slug, "orders:read");
  const shopOff = await requireShopOrAfterSale(member);
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "order").dispute;
  const view = await disputeEvidence(store.id, orderId, disputeId);
  if (!view) notFound();
  const { dispute } = view;
  const locale = store.markets[0]?.locale ?? ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" }).format(new Date(iso));
  const canSend = memberCan(member, "orders:write") && dispute.answerable;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${slug}/orders/${orderId}`, label: w.back }}
        title={<>{w.title}</>}
        description={<>{fillWords(w.description, { amount: formatMoney(dispute.amountMinor, dispute.currency, locale), reason: disputeReasonWords(dispute.reason).toLowerCase() })}</>}
      />
      <div className={`flex flex-col gap-3 p-5 text-sm ${CARD_CLASS}`}>
        {view.submittedAt ? (
          <p role="status">{fillWords(w.sent, { when: when(view.submittedAt) })}</p>
        ) : dispute.provider !== "stripe" ? (
          <p>{w.mollie}</p>
        ) : !dispute.answerable ? (
          <p>{w.notAnswerable}</p>
        ) : (
          <>
            {dispute.evidenceDueBy && <p className="font-medium">{fillWords(w.due, { when: dueWords(new Date(dispute.evidenceDueBy), store.timeZone) })}</p>}
            <p>{w.drafted}</p>
            {view.savedAt && <p className="text-muted">{fillWords(w.saved, { when: when(view.savedAt) })}</p>}
          </>
        )}
        {view.customer.often && (
          <p>
            <Chip signal="warning" dot>
              {fillWords(w.returnsOften, { returned: view.customer.returned, orders: view.customer.orders })}
            </Chip>
          </p>
        )}
        {dispute.testMode && <p className="text-muted">{w.testMode}</p>}
        {dispute.provider === "stripe" && (
          <p>
            <Link href={disputeDashboardUrl(dispute.reference, dispute.testMode)} target="_blank" rel="noreferrer" className="underline">
              {adminText(lang, "order").payment.openInStripe}
            </Link>
          </p>
        )}
      </div>
      <DisputeEvidenceForm fields={view.fields} reason={dispute.reason} action={canSend ? saveEvidenceAction.bind(null, slug, orderId, disputeId) : null} words={w} />
    </div>
  );
}
