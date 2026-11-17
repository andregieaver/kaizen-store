import { fillWords } from "./admin-fill";
import type { CustomersMessages } from "./admin-messages/customers.en";
import type { SubscriberStatus } from "./marketing-consent";
import type { SmsSubscriberStatus } from "./sms";

/**
 * What a customer's page says of the store's marketing to them (ecosystem plan E2.4, D713), pure: their place on the email list, their
 * number's consent to texts, and the saved segments they are in now, each as one line in the page's words with where it opens. The facts are
 * read by `personSubscription()`, `personSms()` and `segmentsOfPerson()`.
 */

export type MarketingWords = CustomersMessages["customer"]["marketing"];

export type MarketingLine = { text: string; href: string | null };

/** Their place on the email list, linked to their subscriber's page; *Not on your list* without a row. */
export function emailListLine(
  subscription: { id: string; status: SubscriberStatus; since: string } | null,
  base: string,
  w: MarketingWords,
  date: (iso: string) => string,
): MarketingLine {
  if (!subscription) return { text: w.emailNone, href: null };
  return { text: fillWords(w.emailStatus[subscription.status], { date: date(subscription.since) }), href: `${base}/subscribers/${encodeURIComponent(subscription.id)}` };
}

/**
 * Their number's consent to texts, linked to Text messages; *Not signed up* while the store texts and they have no number there, and no line
 * at all while it does not text and never did them.
 */
export function textsLine(
  sms: { offered: boolean; number: { status: SmsSubscriberStatus; phone: string; since: string } | null },
  base: string,
  w: MarketingWords,
  date: (iso: string) => string,
): MarketingLine | null {
  if (!sms.number) return sms.offered ? { text: w.textsNone, href: null } : null;
  return { text: fillWords(w.textsStatus[sms.number.status], { phone: sms.number.phone, date: date(sms.number.since) }), href: `${base}/text-messages` };
}
