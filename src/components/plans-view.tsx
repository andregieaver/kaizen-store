import type { CSSProperties, ReactNode } from "react";

import { dateIn, PLATFORM_TIME_ZONE } from "@/lib/dates";
import { limitUnit, type LimitKey } from "@/lib/limits";
import { EURO_MONEY, formatLimit, type AiMoney } from "@/lib/usage-format";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { langOfLocale, platformPath } from "@/lib/platform-lang";
import type { PlansBlock } from "@/lib/page-content";
import { bestYearlySaving, comparisonTable, planCards, type PlanCard, type PlanCardPrice, type PublicPlans } from "@/lib/plan-offer";
import { formatBps, type PlanInterval } from "@/lib/plans";
import type { StorePlan, StorePlanPrice } from "@/lib/store-plans";

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

/** What a card's button buys at a billing period (as `choiceFor()` in `store-plans.ts`, here so a page of Kaizena Flow's plans loads none of it). */
const choiceOf = (plan: StorePlan | undefined, interval: PlanInterval): StorePlanPrice | null =>
  plan?.prices.find((price) => price.interval === interval) ?? null;

/**
 * A store's own plans (D912): what each card's button buys (its plan's variant at the card's billing period, with its purchase option, through
 * `action`, the cart's *Choose plan*), and whether the prices include VAT. Absent, the cards are Kaizena Flow's plans.
 */
export type PlanSale = {
  action: (formData: FormData) => Promise<void>;
  store: string;
  market: string;
  plans: StorePlan[];
  withVat: boolean;
};

/**
 * Kaizen's plans (D142), or a store's own (D912, `sale`): a card for each plan with its price, fee per sale and what it includes, and under them,
 * if the component says so, the comparison table (D132). Pure of data fetching: `PlansSection` reads the plans.
 * The prices are what stores pay Kaizen, without VAT (Norwegian VAT is added at checkout, D18). With the switch (D481) visitors
 * choose monthly or yearly prices: both sets of cards are drawn, and the radio chosen shows one (`data-plan-switch` in
 * `globals.css`), before any script runs and without one.
 */
export function PlansView({ block, data, lang = "en", sale }: { block: PlansBlock; data: PublicPlans; lang?: string; sale?: PlanSale }) {
  const all = t(lang);
  const m = all.plans;
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
  // A store's prices are its own, with VAT unless it sells only to businesses (D912); Kaizena Flow's are what stores pay, without VAT.
  const vatNote = sale ? (sale.withVat ? all.vatIncluded : all.vatExcluded) : m.exVat;
  const button = (card: PlanCard, look: ReturnType<typeof buttonLook>) => {
    if (!sale) {
      return (
        <a href={href} className={look.className} style={look.style} data-kz-text="button">
          {label}
          <span className="sr-only"> – {card.name}</span>
        </a>
      );
    }
    // A plain form for each billing period the card offers: it works before any script, and the cart takes it from there.
    const plan = sale.plans.find((p) => p.id === card.id);
    const form = (interval: PlanInterval, content: ReactNode, className: string, style?: CSSProperties) => {
      const choice = choiceOf(plan, interval);
      return choice ? (
        <form action={sale.action}>
          <input type="hidden" name="store" value={sale.store} />
          <input type="hidden" name="market" value={sale.market} />
          <input type="hidden" name="variantId" value={choice.variantId} />
          <input type="hidden" name="sellingPlanId" value={choice.sellingPlanId} />
          <button type="submit" className={className} style={style} data-kz-text="button">
            {content}
            <span className="sr-only"> – {card.name}</span>
          </button>
        </form>
      ) : null;
    };
    return (
      <>
        {form(card.main.interval, label, look.className, look.style)}
        {card.other && card.main.amountMinor > 0 && form(card.other.interval, m.yearlyPrice(money(card.other)), "text-sm underline underline-offset-2 hover:no-underline")}
      </>
    );
  };
  const trialOf = (card: PlanCard) => {
    const days = choiceOf(sale?.plans.find((p) => p.id === card.id), card.main.interval)?.trialDays ?? 0;
    return days > 0 ? all.planTrial(days) : null;
  };
  const columns = COLUMNS[Math.min(cards.length, 4)];
  const table = block.comparison ? comparisonTable(data, cards) : [];
  // Each set of cards names its headings apart: with the switch both are on the page.
  const grid = (shown: PlanCard[], set = "") => (
    <div className={`grid gap-4 kzb-md-cols-2 ${columns}`}>
      {shown.map((card) => (
        <PlanCardView
          key={card.id}
          headingId={`plan-${set}${card.id}`}
          card={card}
          button={button(card, buttonLook({ variant: card.highlighted ? "filled" : "outline" }, true))}
          vatNote={vatNote}
          // A store's plan says Free as its setting chooses (D913); Kaizena Flow's always do.
          freeWord={sale?.plans.find((p) => p.id === card.id)?.zeroFree === false ? null : all.freeGift}
          trial={trialOf(card)}
          seller={sale ? "store" : "platform"}
          money={money}
          every={every}
          ai={ai}
          m={m}
          lang={lang}
        />
      ))}
    </div>
  );
  const yearly = block.switcher ? planCards(data, { ...options, interval: "year" }).cards : [];
  // A campaign running (D524): its name and last day over the cards, when it gives on any of them. Kaizena Flow's own campaign, so its last
  // day is the platform's, on its own site and on the house store's pages alike (D796).
  const campaign = data.campaign && [...cards, ...yearly].some((card) => card.campaign) ? data.campaign : null;
  const lastDay = campaign ? dateIn(PLATFORM_TIME_ZONE, campaign.expiresAt, "dayMonth", lang) : "";

  return (
    <div className="flex flex-col gap-10">
      {campaign && (
        <p className="self-center rounded-full bg-accent px-4 py-1 text-sm font-medium text-accent-foreground">{m.campaignUntil(campaign.name, lastDay)}</p>
      )}
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
                {/* A store's plans' lines have no categories (D912): one group, with no heading of its own. */}
                {group.category && (
                  <tr>
                    <th scope="rowgroup" colSpan={cards.length + 1} className="pt-5 pb-1 text-xs font-medium tracking-wide text-muted uppercase">
                      {group.category}
                    </th>
                  </tr>
                )}
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
 * Native radios, so the keyboard and screen readers know them; the cards follow by CSS alone. The Extensions block's switch too.
 */
export function IntervalSwitch({ name, start, saving, allSame, m }: { name: string; start: PlanInterval; saving: number | null; allSame: boolean; m: ReturnType<typeof t>["plans"] }) {
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
  button,
  vatNote,
  freeWord,
  trial,
  seller,
  money,
  every,
  ai,
  m,
  lang = "en",
}: {
  headingId: string;
  card: PlanCard;
  /** The card's button: Kaizena Flow's sign-up link, or a store's *Choose plan* form (D912). */
  button: ReactNode;
  vatNote: string;
  /** The word for a plan that costs nothing (D913): "Free", in place of its month, year and VAT; null where its setting shows the amount. */
  freeWord: string | null;
  /** A store's plan's free trial (D912), said under its price. */
  trial: string | null;
  /** Kaizena Flow's plans say their fee per sale and the other price in a line; a store's other price is its own button. */
  seller: "platform" | "store";
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
      {/* A plan that costs nothing (D913) says so, and nothing about months, years or VAT. */}
      {card.main.amountMinor === 0 && !card.campaign && freeWord ? (
        <p className="text-3xl font-semibold" data-kz-text="price">
          {freeWord}
        </p>
      ) : (
      <div>
        {/* Monthly or yearly, the card leads with a month (D481): a yearly price as its twelfth, and what the year comes to under it. */}
        <p className="text-3xl font-semibold" data-kz-text="price">
          {money({ ...card.main, amountMinor: card.display.monthMinor })} <span className="text-base font-normal text-muted">{m.perMonth}</span>
        </p>
        <p className="text-sm text-muted">{(card.display.billed === "year" ? m.billedYearly : m.billedMonthly)(money({ ...card.main, amountMinor: card.display.yearMinor }))}</p>
        {/* A campaign's price (D524): for how long, and the price after; the regular month struck through when it lasts. */}
        {card.campaign &&
          (card.campaign.lasts === "forever" ? (
            <p className="text-sm">
              <span className="sr-only">{m.wasPrice} </span>
              <s className="text-muted">{money({ ...card.main, amountMinor: card.display.regularMonthMinor })}</s> {m.campaignForever}
            </p>
          ) : (
            <p className="text-sm">
              {card.campaign.lasts === "once" ? m.campaignOnce(`${money(card.main)} ${every(card.main)}`) : m.campaignMonths(card.campaign.lasts, `${money(card.main)} ${every(card.main)}`)}
            </p>
          ))}
        <p className="text-xs text-muted">{vatNote}</p>
        {trial && <p className="mt-1 text-sm font-medium">{trial}</p>}
        {card.other && seller === "platform" && <p className="mt-1 text-sm">{m.yearlyPrice(money(card.other))}</p>}
        {card.yearlySavingPercent !== null && <p className="text-sm font-medium text-accent">{m.saveYearly(String(card.yearlySavingPercent))}</p>}
      </div>
      )}
      {seller === "platform" && <p className="text-sm">{m.fee(formatBps(card.saleFeeBps, lang))}</p>}
      <div className="flex flex-col items-center gap-2">{button}</div>
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
