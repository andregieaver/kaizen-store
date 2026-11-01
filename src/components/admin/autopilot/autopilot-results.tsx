import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AssistantMessages } from "@/lib/admin-messages/assistant.en";
import { EFFECT_DAYS, liftMinor, signedMoney, type EffectsMonth } from "@/lib/autopilot-effects";
import { formatMoney } from "@/lib/money";
import type { AutopilotOverview } from "@/server/autopilot-overview";

type Words = AssistantMessages["autopilot"];

/**
 * The Autopilot page's Results (D418): what the autopilot changed this month and last, what the products it changed sold before and after and
 * beyond the store's own trend, and each change measured with the store's own figure beside it. Every figure is written by code; the page says
 * it is a comparison, not proof.
 */
/** A tool's name as the activity log reads it: `update_product` is "Update product". */
const toolWords = (tool: string) => {
  const words = tool.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function AutopilotResults({ effects, words: a }: { effects: NonNullable<AutopilotOverview["effects"]>; words: Words }) {
  const r = a.results;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, effects.locale);
  const signed = (minor: number, currency: string) => signedMoney(minor, (m) => money(m, currency));
  const month = (title: string, m: EffectsMonth) => (
    <Card title={title}>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <div className="contents">
          <dt className="text-body text-ink-2">{r.actions}</dt>
          <dd className="text-body text-ink">{m.actions}</dd>
        </div>
        <div className="contents">
          <dt className="text-body text-ink-2">{r.measured}</dt>
          <dd className="text-body text-ink">{m.measured}</dd>
        </div>
        {m.products > 0 && (
          <div className="contents">
            <dt className="text-body text-ink-2">{r.products}</dt>
            <dd className="text-body text-ink">{fillWords(r.beforeAfter, { before: money(m.beforeMinor, m.currency), after: money(m.afterMinor, m.currency) })}</dd>
          </div>
        )}
        {m.liftMinor !== null && (
          <div className="contents">
            <dt className="text-body text-ink-2">{r.lift}</dt>
            <dd className="text-body text-ink">
              <span className={m.liftMinor < 0 ? "text-danger-text" : undefined}>{signed(m.liftMinor, m.currency)}</span>
              <span className="block text-sm text-muted">{fillWords(r.aboveBelow, { above: m.above, below: m.below })}</span>
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
  return (
    <section aria-labelledby="autopilot-results" className="flex flex-col gap-4">
      <div>
        <h2 id="autopilot-results" className="text-title text-ink">
          {r.title}
        </h2>
        <p className="text-body text-ink-2">{r.description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {month(r.thisMonth, effects.thisMonth)}
        {month(r.lastMonth, effects.lastMonth)}
      </div>
      {effects.thisMonth.liftMinor !== null || effects.lastMonth.liftMinor !== null ? <p className="text-sm text-muted">{r.liftNote}</p> : null}
      <Card title={r.recent}>
        {effects.recent.length === 0 ? (
          <p className="text-body text-ink-2">{r.none}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {effects.recent.map((e) => {
              const lift = liftMinor(e);
              return (
                <li key={e.auditId} className="flex flex-col gap-1 py-3 text-sm" data-effect={e.auditId}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{toolWords(e.tool)}</span>
                    <Chip>{e.targetKind === "product" ? `${r.product}: ${e.targetLabel}` : r.store}</Chip>
                    <span className="text-muted">{e.actedAt.slice(0, 10)}</span>
                  </span>
                  <span>
                    {money(e.beforeMinor, e.currency)} → {money(e.afterMinor, e.currency)} <span className="text-muted">({fillWords(r.days, { days: EFFECT_DAYS })})</span>
                  </span>
                  {e.targetKind === "product" && (
                    <span className="text-muted">
                      {fillWords(r.storeSame, { before: money(e.storeBeforeMinor, e.currency), after: money(e.storeAfterMinor, e.currency) })}
                      {lift === null ? ` · ${r.notRead}` : ` · ${r.lift}: ${signed(lift, e.currency)}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
