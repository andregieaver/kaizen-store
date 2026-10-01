import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import type { PlansBlock } from "@/lib/page-content";
import { comparisonTable, planCards, type PlanCard, type PlanCardPrice, type PublicPlans } from "@/lib/plan-offer";
import { formatBps } from "@/lib/plans";

import { buttonLook } from "./page-block";

// Written out whole so Tailwind finds every class.
const COLUMNS = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"] as const;

const Check = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Kaizen's plans (D142): a card for each plan with its price, fee per sale and what it includes, and under them,
 * if the component says so, the comparison table (D132). Pure of data fetching: `PlansSection` reads the plans.
 * The prices are what stores pay Kaizen, without VAT (Norwegian VAT is added at checkout, D18).
 */
export function PlansView({ block, data, lang = "en" }: { block: PlansBlock; data: PublicPlans; lang?: string }) {
  const m = t(lang).plans;
  const { currency, cards } = planCards(data, { currency: block.currency, interval: block.interval, highlightId: block.highlightId });
  if (!currency || cards.length === 0) return null;
  const href = block.buttonHref || "/sign-up";
  const label = block.buttonLabel || m.choose;
  const money = (price: PlanCardPrice) => formatMoney(price.amountMinor, price.currency, lang);
  const every = (price: PlanCardPrice) => (price.interval === "month" ? m.perMonth : m.perYear);
  const columns = COLUMNS[Math.min(cards.length, 4)];
  const table = block.comparison ? comparisonTable(data, cards) : [];

  return (
    <div className="flex flex-col gap-10">
      <div className={`grid gap-4 sm:grid-cols-2 ${columns}`}>
        {cards.map((card) => (
          <PlanCardView key={card.id} card={card} look={buttonLook({ variant: card.highlighted ? "filled" : "outline" }, true)} href={href} label={label} money={money} every={every} m={m} />
        ))}
      </div>
      {table.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-120 border-collapse text-left text-sm">
            <caption className="pb-3 text-left text-lg font-semibold">{m.compare}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-normal text-muted">{m.feature}</th>
                {cards.map((card) => (
                  <th key={card.id} scope="col" className="px-3 py-2 text-center font-semibold">{card.name}</th>
                ))}
              </tr>
            </thead>
            {table.map((group) => (
              <tbody key={group.category}>
                <tr>
                  <th scope="rowgroup" colSpan={cards.length + 1} className="pt-5 pb-1 text-xs font-medium tracking-wide text-muted uppercase">
                    {group.category}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      {row.name}
                      {row.description && <span className="block text-xs text-muted">{row.description}</span>}
                    </th>
                    {row.included.map((has, index) => (
                      <td key={cards[index].id} className="px-3 py-2 text-center">
                        <span aria-hidden="true">{has ? "✓" : "–"}</span>
                        <span className="sr-only">{has ? m.included : m.notIncluded}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

function PlanCardView({
  card,
  look,
  href,
  label,
  money,
  every,
  m,
}: {
  card: PlanCard;
  look: ReturnType<typeof buttonLook>;
  href: string;
  label: string;
  money: (price: PlanCardPrice) => string;
  every: (price: PlanCardPrice) => string;
  m: ReturnType<typeof t>["plans"];
}) {
  return (
    <section
      aria-labelledby={`plan-${card.id}`}
      className={`relative flex flex-col gap-4 rounded-lg border bg-background p-6 ${card.highlighted ? "border-accent ring-2 ring-accent" : "border-border"}`}
    >
      {card.highlighted && (
        <p className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-0.5 text-xs font-medium text-accent-foreground">{m.popular}</p>
      )}
      <div>
        <h3 id={`plan-${card.id}`} className="text-xl font-semibold">{card.name}</h3>
        {card.description && <p className="mt-1 text-sm text-muted">{card.description}</p>}
      </div>
      <div>
        <p className="text-3xl font-semibold">
          {money(card.main)} <span className="text-base font-normal text-muted">{every(card.main)}</span>
        </p>
        <p className="text-xs text-muted">{m.exVat}</p>
        {card.other && <p className="mt-1 text-sm">{m.yearlyPrice(money(card.other))}</p>}
        {card.yearlySavingPercent !== null && <p className="text-sm font-medium text-accent">{m.saveYearly(String(card.yearlySavingPercent))}</p>}
      </div>
      <p className="text-sm">{m.fee(formatBps(card.saleFeeBps))}</p>
      <a href={href} className={look.className} style={look.style}>
        {label}
        <span className="sr-only"> – {card.name}</span>
      </a>
      {card.features.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">{m.includes}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {card.features.map((feature) => (
              <li key={feature.id} className="flex gap-2">
                <Check />
                <span>{feature.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
