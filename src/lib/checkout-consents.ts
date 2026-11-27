import type { Messages } from "./messages/en";
import type { PlanTerms } from "./subscriptions";

/** A purchase option's terms the consent states (D29): its period, the days free first and the payments committed to. */
export type ConsentPlan = Pick<PlanTerms, "interval" | "intervalCount"> & { trialDays: number; minCycles: number };

/**
 * What a checkout asks the shopper to agree to, in the shopper's words, written once for the cart's ticks and the button that skips the cart (D915):
 * a download's withdrawal (D24), a booked service's express request (D407), and a subscription's renewals with its trial and commitment (D29),
 * never for one that renews at nothing (D913). `renewal` is what each renewal costs, `money` how the cart writes an amount.
 */
export function checkoutConsents(
  m: Pick<Messages, "digitalConsent" | "serviceRequest" | "subscriptionConsent" | "planEvery" | "trialNote" | "commitmentNote">,
  asked: { digital: boolean; service: boolean; plan: ConsentPlan | null; renewal: number | null },
  money: (minor: number) => string,
): { digital?: string; service?: string; subscription?: string } {
  const { plan, renewal } = asked;
  return {
    digital: asked.digital ? m.digitalConsent : undefined,
    service: asked.service ? m.serviceRequest : undefined,
    subscription:
      plan && renewal !== null && renewal > 0
        ? [
            m.subscriptionConsent(m.planEvery(plan.interval, plan.intervalCount), money(renewal)),
            plan.trialDays > 0 && m.trialNote(plan.trialDays),
            plan.minCycles > 0 && m.commitmentNote(plan.minCycles),
          ]
            .filter(Boolean)
            .join(" ")
        : undefined,
  };
}

/**
 * Whether the button pressed said everything the checkout asks (D915): each consent the basket asks is one of the sentences shown beside the button.
 * Else the shopper is shown the cart, whose ticks ask it.
 */
export function agreedAll(asked: { digital?: string; service?: string; subscription?: string }, shown: readonly string[]): boolean {
  return Object.values(asked).every((text) => text === undefined || shown.includes(text));
}
