import { limitUnit, type LimitKey } from "@/lib/limits";
import { EURO_MONEY, formatLimit, type AiMoney } from "@/lib/usage-format";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { langOfLocale, platformPath } from "@/lib/platform-lang";
import type { PlansBlock } from "@/lib/page-content";
import { bestYearlySaving, comparisonTable, planCards, type PlanCard, type PlanCardPrice, type PublicPlans } from "@/lib/plan-offer";
import { formatBps, type PlanInterval } from "@/lib/plans";

import { buttonLook } from "./page-block";

// Written out whole so Tailwind finds every class.
// From Large, by the store's screen sizes (D179, `BREAKPOINT_CLASSES`).
const COLUMNS = ["", "kzb-lg-cols-1", "kzb-lg-cols-2", "kzb-lg-cols-3", "kzb-lg-cols-4"] as const;

const Check = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The money the AI a plan includes is written in (D481): the page's currency at the ECB's rate, else euros, as it is set; with the
 * component's choice of decimals.
 */
function aiMoneyIn(currency: string, data: PublicPlans, decimals: PlansBlock["decimals"]): AiMoney {
  const perEuro = currency === "EUR" ? 1 : data.euroRates?.[currency];
  return perEuro ? { currency, perEuro, decimals } : { ...EURO_MONEY, decimals };
}

/**
 * Kaizen's plans (D142): a card for each plan with its price, fee per sale and what it includes, and under them,
 * if the component says so, the comparison table (D132). Pure of data fetching: `PlansSection` reads the plans.
 * The prices are what stores pay Kaizen, without VAT (Norwegian VAT is added at checkout, D18). With the switch (D481) visitors
 * choose monthly or yearly prices: both sets of cards are drawn, and the radio chosen shows one (`data-plan-switch` in
 * `globals.css`), before any script runs and without one.
 */
export function PlansView({ block, data, lang = "en" }: { block: PlansBlock; data: PublicPlans; lang?: string }) {
  const m = t(lang).plans;
  const options = { currency: block.currency, highlightId: block.highlightId };
  const { currency, cards } = planCards(data, { ...options, interval: block.switcher ? "month" : block.interval });
  if (!currency || cards.length === 0) return null;
  // The site's own address in the page's language (`/no/sign-up`): Kaizena Flow's own pages had it from `linksIn()`, its store's (D484) not.
  const href = platformPath(langOfLocale(lang) ?? "en", block.buttonHref || "/sign-up");
  const label = block.buttonLabel || m.choose;
  const style = { decimals: block.decimals };
  const money = (price: PlanCardPrice) => formatMoney(price.amountMinor, price.currency, lang, style);
  const every = (price: PlanCardPrice) => (price.interval === "month" ? m.perMonth : m.perYear);
  const ai = aiMoneyIn(currency, data, block.decimals);
  const columns = COLUMNS[Math.min(cards.length, 4)];
  const table = block.comparison ? comparisonTable(data, cards) : [];
  // Each set of cards names its headings apart: with the switch both are on the page.
  const grid = (shown: PlanCard[], set = "") => (
    <div className={`grid gap-4 kzb-md-cols-2 ${columns}`}>
      {shown.map((card) => (
        <PlanCardView key={card.id} headingId={`plan-${set}${card.id}`} card={card} look={buttonLook({ variant: card.highlighted ? "filled" : "outline" }, true)} href={href} label={label} money={money} every={every} ai={ai} m={m} lang={lang} />
      ))}
    </div>
  );
  const yearly = block.switcher ? planCards(data, { ...options, interval: "year" }).cards : [];

  return (
    <div className="flex flex-col gap-10">
      {block.switcher ? (
        <div data-plan-switch="" className="flex flex-col gap-8">
          <IntervalSwitch name={`plans-${block.id}`} start={block.interval === "year" ? "year" : "month"} saving={bestYearlySaving(yearly)} allSame={new Set(yearly.map((c) => c.yearlySavingPercent).filter((p) => p !== null)).size === 1} m={m} />
          <div data-plan-panel="month">{grid(cards, "month-")}</div>
          <div data-plan-panel="year">{grid(yearly, "year-")}</div>
        </div>
      ) : (
        grid(cards)
      )}
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

/**
 * Monthly or yearly (D481): two radio buttons drawn as one control, the chosen one filled; what the yearly prices save beside it.
 * Native radios, so the keyboard and screen readers know them; the cards follow by CSS alone.
 */
function IntervalSwitch({ name, start, saving, allSame, m }: { name: string; start: PlanInterval; saving: number | null; allSame: boolean; m: ReturnType<typeof t>["plans"] }) {
  const option = (interval: PlanInterval, text: string) => (
    <span className="relative">
      <input type="radio" name={name} id={`${name}-${interval}`} value={interval} defaultChecked={interval === start} data-plan-pick={interval} className="peer sr-only" />
      <label
        htmlFor={`${name}-${interval}`}
        className="block cursor-pointer rounded-full px-5 py-2 text-sm font-medium text-muted transition-colors peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
      >
        {text}
      </label>
    </span>
  );
  return (
    <fieldset className="flex flex-wrap items-center justify-center gap-3">
      <legend className="sr-only">{m.period}</legend>
      <span className="inline-flex rounded-full border border-border bg-background p-1">
        {option("month", m.monthly)}
        {option("year", m.yearly)}
      </span>
      {saving !== null && <span className="text-sm font-medium text-accent">{allSame ? m.save(String(saving)) : m.saveUpTo(String(saving))}</span>}
    </fieldset>
  );
}

/** A limit's name after its amount: one of a kind in the singular ("1 store"), else as the plural the names are written in. */
function limitName(m: ReturnType<typeof t>["plans"], key: LimitKey, value: number | null): string {
  return (value === 1 && m.limitNamesOne[key as keyof typeof m.limitNamesOne]) || m.limitNames[key];
}

function PlanCardView({
  headingId,
  card,
  look,
  href,
  label,
  money,
  every,
  ai,
  m,
  lang = "en",
}: {
  headingId: string;
  card: PlanCard;
  look: ReturnType<typeof buttonLook>;
  href: string;
  label: string;
  money: (price: PlanCardPrice) => string;
  every: (price: PlanCardPrice) => string;
  ai: AiMoney;
  m: ReturnType<typeof t>["plans"];
  lang?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={`relative flex flex-col gap-4 rounded-lg border bg-background p-6 ${card.highlighted ? "border-accent ring-2 ring-accent" : "border-border"}`}
    >
      {card.highlighted && (
        <p className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-0.5 text-xs font-medium text-accent-foreground">{m.popular}</p>
      )}
      <div>
        <h3 id={headingId} className="text-xl font-semibold" data-kz-text="name">
          {card.name}
        </h3>
        {card.description && <p className="mt-1 text-sm text-muted">{card.description}</p>}
      </div>
      <div>
        <p className="text-3xl font-semibold" data-kz-text="price">
          {money(card.main)} <span className="text-base font-normal text-muted">{every(card.main)}</span>
        </p>
        <p className="text-xs text-muted">{m.exVat}</p>
        {card.other && <p className="mt-1 text-sm">{m.yearlyPrice(money(card.other))}</p>}
        {card.yearlySavingPercent !== null && <p className="text-sm font-medium text-accent">{m.saveYearly(String(card.yearlySavingPercent))}</p>}
      </div>
      <p className="text-sm">{m.fee(formatBps(card.saleFeeBps, lang))}</p>
      <a href={href} className={look.className} style={look.style} data-kz-text="button">
        {label}
        <span className="sr-only"> – {card.name}</span>
      </a>
      {card.limits.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm" data-kz-text="meta">
          {card.limits.map((limit) => (
            <li key={limit.key} className="flex gap-2">
              <Check />
              <span>
                {limit.value === null ? `${limitUnit(limit.key) === "count" ? m.unlimitedCounted : m.unlimited} ${m.limitNames[limit.key]}` : `${formatLimit(limit.key, limit.value, lang, ai)} ${limitName(m, limit.key, limit.value)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {card.features.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">{m.includes}</p>
          <ul className="flex flex-col gap-1.5 text-sm" data-kz-text="meta">
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
