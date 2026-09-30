import Link from "next/link";

import { BonusCreditsForm } from "@/components/bonus-credits-form";
import { creditsInputValue, creditsMode, earnPercentText, type CreditsState } from "@/lib/bonus-shopper";
import type { CartBonus } from "@/lib/bonus";
import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

/** How long until credits earned on this order can be used, as a phrase: "14 days after you pay". */
export function waitPhrase(m: Messages, pendingDays: number): string {
  return pendingDays > 0 ? m.bonus.afterPay(m.bonus.dayCount(pendingDays)) : m.bonus.rightAfterPay;
}

/**
 * The bonus credits in the cart and at checkout (D130), in the state the shopper is in: a guest is invited to sign in to
 * earn, a signed-in customer with credits can use them, and one with nothing to use is told what this order earns.
 * `action` is the server action of the page it is on (the cart's, or the checkout's that places the order again).
 * Amounts are the market's currency. Nothing when the program is off.
 */
export function BonusCredits({
  bonus,
  m,
  currency,
  locale,
  signInHref,
  action,
}: {
  bonus: CartBonus;
  m: Messages;
  currency: string;
  locale: string;
  signInHref: string;
  action: (state: CreditsState, form: FormData) => Promise<CreditsState>;
}) {
  const mode = creditsMode(bonus);
  if (mode === "off") return null;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const b = m.bonus;

  if (mode === "guest") {
    return (
      <p className="text-sm text-muted">
        <Link href={signInHref} className="underline">
          {b.signInToEarn(earnPercentText(bonus.earnPercent, locale))}
        </Link>
      </p>
    );
  }

  const notes = (
    <>
      {bonus.pendingMinor > 0 && <p className="text-sm text-muted">{b.pendingNote(money(bonus.pendingMinor))}</p>}
      {bonus.willEarnMinor > 0 && (
        <p className="text-sm text-muted">{b.willEarn(money(bonus.willEarnMinor), waitPhrase(m, bonus.pendingDays))}</p>
      )}
    </>
  );

  if (mode === "note") {
    return (
      <div className="flex flex-col gap-1">
        {bonus.availableMinor > 0 && <p className="text-sm text-muted">{b.noneUsable(money(bonus.availableMinor))}</p>}
        {notes}
      </div>
    );
  }

  return (
    <div role="group" aria-label={b.useHeading} className="flex flex-col gap-2">
      <p className="font-medium" aria-hidden="true">
        {b.useHeading}
      </p>
      <BonusCreditsForm
        action={action}
        using={bonus.usingMinor > 0}
        defaultAmount={creditsInputValue(bonus.usingMinor, currency, locale)}
        limits={b.haveAvailable(money(bonus.availableMinor), money(bonus.maxUsableMinor))}
        labels={{ use: b.useLabel, amount: b.amountLabel, all: b.useAll, apply: b.apply, applying: b.applying }}
      />
      {notes}
    </div>
  );
}
