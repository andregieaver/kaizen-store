import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { Challenge } from "@/lib/autopilot-challenge";
import type { ConsoleMessages } from "@/lib/admin-messages/console.en";

import { saveChallengeAction } from "./actions";

const input = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** The budgets in the order the form shows them, each with its default (the challenge schema's). */
const BUDGETS = [
  ["aiMonthlyUsd", 300, "1"],
  ["marginFloorPercent", 10, "0.5"],
  ["priceChangePercent", 15, "1"],
  ["discountPercent", 20, "1"],
  ["adRaisePercent", 20, "1"],
  ["broadcastsPerWeek", 2, "1"],
  ["supportRepliesPerDay", 200, "1"],
  ["purchasePerOrder", null, "1"],
  ["purchaseMonthly", null, "1"],
  ["replacementMax", null, "1"],
  ["adMoney", null, "1"],
] as const;

/**
 * Setting or changing a store's challenge (H2): for Homer the store and three dates, the budgets one step away with the plan's defaults filled
 * in; a store's own card fills in its challenge as set.
 */
export function ChallengeForm({ w, store, current }: { w: ConsoleMessages["challenges"]; store?: string; current?: Challenge }) {
  const f = w.fields;
  return (
    <ActionForm action={saveChallengeAction} className="flex flex-col gap-4">
      {store ? (
        <input type="hidden" name="store" value={store} />
      ) : (
        <label className="flex max-w-md flex-col gap-1 text-sm">
          {f.store}
          <input name="store" type="text" required autoComplete="off" spellCheck={false} className={input} aria-describedby="challenge-store-help" />
          <span id="challenge-store-help" className="text-caption text-muted">
            {f.storeHelp}
          </span>
        </label>
      )}
      <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
        {(["startsOn", "dayOne", "endsOn"] as const).map((key) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            {f[key]}
            <input name={key} type="date" required defaultValue={current?.[key]} className={input} />
          </label>
        ))}
      </div>
      <details className="max-w-2xl">
        <summary className="cursor-pointer text-sm text-ink-2">{f.budgets}</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {BUDGETS.map(([key, fallback, step]) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              {f[key]}
              <input name={key} type="number" min={0} step={step} defaultValue={current?.[key] ?? fallback ?? ""} className={input} />
            </label>
          ))}
        </div>
      </details>
      <div>
        <SubmitButton>{store ? w.change : w.save}</SubmitButton>
      </div>
    </ActionForm>
  );
}
