import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CARD_CLASS, Field, TextInput } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { formatMoney } from "@/lib/money";
import { PRICE_TUNING_LEVELS, PRICE_TUNING_RANGE_MAX, PRICE_TUNING_RANGE_MIN, type PriceTuning } from "@/lib/price-tuning";
import type { recentPriceChanges } from "@/server/price-tuning";

import { savePriceTuningAction } from "./actions";

type W = PlatformMessages["plans"]["aiPrices"];
type Change = Awaited<ReturnType<typeof recentPriceChanges>>[number];

/**
 * How far the AI may change Kaizena Flow's prices (D854): three plain choices, the range one step in, and what it changed lately with its
 * reasons. The AI's own words are shown as text.
 */
export function AiPricesCard({ tuning, changes, w, lang, locale }: { tuning: PriceTuning; changes: readonly Change[]; w: W; lang: AdminLang; locale: string }) {
  const choice = { off: [w.off, w.offHint], propose: [w.propose, w.proposeHint], auto: [w.auto, w.autoHint] } as const;
  return (
    <section aria-labelledby="ai-prices" className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
      <div>
        <h2 id="ai-prices" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">{w.lead}</p>
      </div>
      <ActionForm action={savePriceTuningAction} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="sr-only">{w.title}</legend>
          {PRICE_TUNING_LEVELS.map((level) => (
            <label key={level} className="flex items-start gap-2">
              <input type="radio" name="level" value={level} defaultChecked={tuning.level === level} className="mt-1 size-4" />
              <span>
                <span className="text-body-strong text-ink">{choice[level][0]}</span>
                <span className="block text-muted">{choice[level][1]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label={w.range} hint={w.rangeHint} className="w-40">
          {(control) => <TextInput {...control} name="range" type="number" min={PRICE_TUNING_RANGE_MIN} max={PRICE_TUNING_RANGE_MAX} defaultValue={tuning.rangePercent} />}
        </Field>
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
      {changes.length > 0 && (
        <div className="flex flex-col gap-2 text-sm">
          <h3 className="text-body-strong text-ink">{w.recent}</h3>
          <ul className="flex flex-col gap-2">
            {changes.map((c, i) => (
              <li key={i}>
                <span className="text-ink">
                  {fillWords(w.change, {
                    what: c.what,
                    from: formatMoney(c.from_minor, c.currency, locale),
                    to: formatMoney(c.to_minor, c.currency, locale),
                    per: c.interval === "year" ? w.perYear : w.perMonth,
                    how: c.decided === "auto" ? w.onItsOwn : w.approved,
                  })}
                </span>
                <span className="text-muted"> · {adminDate(PLATFORM_TIME_ZONE, c.at, "dayTime", lang)}</span>
                <span className="block text-muted">{c.reasons}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
