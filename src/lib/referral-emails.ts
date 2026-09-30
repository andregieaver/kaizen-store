import type { EmailContent } from "./email-layout";
import { formatMoney } from "./money";
import { bpsText } from "./referrals";

/**
 * Kaizen's two emails to a referrer (D131): the store they referred was opened, and credit was put on their invoice.
 * Kaizen writes to its owners in English, as in its plan reminders. Nothing in them names the referred store's people or
 * customers: a store's name only.
 */

const FOOTER = ["Kaizen · kaizenstore.cloud"];

export function referredStoreOpenedEmail(input: { storeName: string; commissionBps: number; months: number; url: string }): EmailContent {
  return {
    subject: `${input.storeName} opened its store through your link`,
    preview: `You earn ${bpsText(input.commissionBps)} of what it pays Kaizen for ${input.months} months, as credit on your own invoices.`,
    lang: "en",
    footer: FOOTER,
    blocks: [
      { type: "heading", text: "Your referral opened a store" },
      { type: "paragraph", text: `${input.storeName} opened its Kaizen store through your referral link.` },
      {
        type: "paragraph",
        text: `For the next ${input.months} months you earn ${bpsText(input.commissionBps)} of the fees it pays Kaizen, its plan and Kaizen's fee on its sales, as credit on your own Kaizen invoices. Credit can be used a few weeks after the fee is paid.`,
      },
      { type: "button", text: "See your referrals", url: input.url },
    ],
  };
}

export function referralCreditAppliedEmail(input: {
  amountMinor: number;
  currency: string;
  invoiceNumber: string | null;
  url: string;
}): EmailContent {
  const amount = formatMoney(input.amountMinor, input.currency, "en-GB");
  const invoice = input.invoiceNumber ? `invoice ${input.invoiceNumber}` : "your next invoice";
  return {
    subject: `${amount} of referral credit was taken off your Kaizen invoice`,
    preview: `Your referral credit paid for part of ${invoice}.`,
    lang: "en",
    footer: FOOTER,
    blocks: [
      { type: "heading", text: "Referral credit used" },
      { type: "paragraph", text: `${amount} of your referral credit was taken off ${invoice}, so you pay that much less.` },
      { type: "button", text: "See your referrals", url: input.url },
    ],
  };
}
