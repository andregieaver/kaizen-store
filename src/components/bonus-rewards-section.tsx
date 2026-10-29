import type { RedeemedCode, ShopperReward } from "@/lib/bonus-rewards";
import type { Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

/**
 * My account's rewards and birthday (D401), under the credits: each reward with its cost and a button that spends the credits and makes the
 * customer's code (a form posting to a server action, so it works without scripts), the codes they redeemed, and their birthday as month and day.
 */
export function BonusRewardsSection({
  rewards,
  codes,
  birthday,
  birthdayMinor,
  currency,
  locale,
  m,
  outcome,
  redeem,
  saveBirthday,
}: {
  rewards: ShopperReward[];
  codes: RedeemedCode[];
  birthday: string | null;
  /** The birthday credit in the currency shown; 0 when the store gives none (the birthday field is then left out). */
  birthdayMinor: number;
  currency: string;
  locale: string;
  m: Messages;
  outcome: "ok" | "failed" | null;
  redeem: (rewardId: string) => Promise<void>;
  saveBirthday: (form: FormData) => Promise<void>;
}) {
  const b = m.bonus;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const [month, day] = birthday ? birthday.split("-") : ["", ""];
  return (
    <>
      {(rewards.length > 0 || codes.length > 0) && (
        <section aria-labelledby="bonus-rewards" className="flex flex-col gap-3">
          <h2 id="bonus-rewards" className="font-heading text-xl">
            {b.rewardsHeading}
          </h2>
          <p className="text-sm opacity-80">{b.rewardsIntro}</p>
          {outcome && (
            <p role="status" className="text-sm">
              {outcome === "ok" ? b.redeemed : b.redeemFailed}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {rewards.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span>
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-sm opacity-80">{b.rewardCost(money(r.costMinor))}</span>
                </span>
                {r.affordable ? (
                  <form action={redeem.bind(null, r.id)}>
                    <button type="submit" className="button-primary rounded-button px-4 py-2 text-sm">
                      {b.redeem}
                    </button>
                  </form>
                ) : (
                  <span className="text-sm opacity-70">{b.tooFew}</span>
                )}
              </li>
            ))}
          </ul>
          {codes.length > 0 && (
            <>
              <h3 className="font-heading text-lg">{b.codesHeading}</h3>
              <ul className="flex flex-col gap-2">
                {codes.map((c) => (
                  <li key={c.code} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="block">{c.rewardName}</span>
                      <code className="font-mono text-base tracking-wider">{c.code}</code>
                    </span>
                    <span className="opacity-80">
                      {c.used ? b.codeUsed : c.ended ? b.codeEnded : c.endsAt ? b.codeEnds(new Date(c.endsAt).toLocaleDateString(locale, { dateStyle: "long" })) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {birthdayMinor > 0 && (
        <section aria-labelledby="bonus-birthday" className="flex flex-col gap-3">
          <h2 id="bonus-birthday" className="font-heading text-xl">
            {b.birthdayHeading}
          </h2>
          <p className="text-sm opacity-80">{b.birthdayIntro(money(birthdayMinor))}</p>
          <form action={saveBirthday} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {b.birthdayMonth}
              <input name="month" type="number" min={1} max={12} defaultValue={month ? String(Number(month)) : ""} className="w-20 rounded-button border border-border bg-background px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {b.birthdayDay}
              <input name="day" type="number" min={1} max={31} defaultValue={day ? String(Number(day)) : ""} className="w-20 rounded-button border border-border bg-background px-3 py-2" />
            </label>
            <button type="submit" className="button-primary rounded-button px-4 py-2 text-sm">
              {b.birthdaySave}
            </button>
            {birthday && (
              <button type="submit" name="remove" value="1" className="rounded-button px-4 py-2 text-sm underline">
                {b.birthdayRemove}
              </button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
