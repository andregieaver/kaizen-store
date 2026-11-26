import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { MarketCheckMessages } from "@/lib/admin-messages/market-check.en";
import { formatCount, formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { offerFresh, pathShown, priceGap, type RivalSiteFacts } from "@/lib/market-rivals";
import type { KeptOffer, KeptServicePrice, Rival } from "@/server/market-rivals";

import { CARD_CLASS } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Field, Select, TextInput } from "../ui/field";
import { DataTable, StatusPill, type Column } from "./data-table";
import { MarketServicePrices, type MarketServicePricesProps } from "./market-service-prices";
import { AnalyticsSection } from "./section";

/**
 * Analytics → Markets' rivals (D900 M2, `docs/market-check.md` 4): the shops the owner added per country, the offers read of their own
 * product pages and how each stands against the store's price there, worked out by `priceGap()`. Adding a rival is the owner's own act
 * (that is what makes it one they recognise); a product page is read through the research reader, robots.txt first and the page's own
 * data only. Every store has rivals (D905): under each, what changed on its site from the sitemaps it publishes; the offers and *Read the
 * page* need the shop (`sells`). Drawn on the server; the forms post to the page's actions.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type MarketRivalsProps = {
  lang: AdminLang;
  /** The locale amounts are written in (as the rest of the page), and the store's time zone a reading's day is said in. */
  locale: string;
  timeZone: string;
  words: MarketCheckMessages["rivals"];
  rivals: readonly Rival[];
  /** What changed on each rival's site (D905), by rival. */
  sites: readonly RivalSiteFacts[];
  /** The store has a shop: its products can be held against rivals' offers. */
  sells: boolean;
  offers: readonly KeptOffer[];
  /**
   * Their published service prices (D905 M5d), kept by hand, with what a price is for in words and the store's currencies; null for
   * Kaizena Flow's own store, whose prices are its plans.
   */
  services: { prices: readonly KeptServicePrice[]; per: MarketServicePricesProps["per"]; currencies: readonly string[] } | null;
  /** The store's countries, by code and name, for the country of a new rival. */
  countries: readonly { code: string; name: string }[];
  /** The store's products a rival's page may be held against, by handle and title. */
  products: readonly { handle: string; title: string }[];
  /** The forms' actions, or null when the member may only read. */
  actions: { add: Action; remove: Action; read: Action; keepPrice: Action; removePrice: Action } | null;
  now: Date;
};

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

/** A rival's site in a line (D905): its pages, what it added and took down in 30 days, where most were added, and when it was read, or why not. */
function SiteLine({ site, w, day }: { site: RivalSiteFacts | undefined; w: MarketCheckMessages["rivals"]["site"]; day: (iso: string) => string }) {
  if (!site?.readAt) return <span className="text-muted">{w.waiting}</span>;
  if (site.problem === "robots") return <span className="text-muted">{w.problems.robots}</span>;
  if (site.problem || site.pages === null || !site.since) return <span className="text-muted">{fillWords(w.problems[site.problem ?? "unread"], { date: day(site.readAt) })}</span>;
  const pages = site.cut ? fillWords(w.pagesCut, { n: formatCount(site.pages) }) : countWords(site.pages, w.pages, { n: formatCount(site.pages) });
  const first = site.since === site.readAt && site.added === 0;
  const parts = first
    ? [pages, fillWords(w.first, { date: day(site.readAt) })]
    : [
        pages,
        fillWords(w.added, { n: formatCount(site.added) }),
        site.gone > 0 ? fillWords(w.gone, { n: formatCount(site.gone) }) : null,
        site.section ? fillWords(w.under, { section: pathShown(site.section) }) : null,
        fillWords(w.read, { date: day(site.readAt) }),
      ];
  return (
    <>
      <span className="text-muted" data-rival-site>
        {parts.filter(Boolean).join(" · ")}
      </span>
      {site.newest.length > 0 ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
          <span>{`${w.newest}:`}</span>
          {site.newest.map((path) => (
            <a key={path} href={`https://${site.host}${path}`} target="_blank" rel="noopener noreferrer nofollow" className={linkClass}>
              {pathShown(path)}
            </a>
          ))}
        </span>
      ) : null}
    </>
  );
}

export function MarketRivalsSection({ lang, locale, timeZone, words: w, rivals, sites, sells, offers, services, countries, products, actions, now }: MarketRivalsProps) {
  const names = new Map(countries.map((c) => [c.code, c.name]));
  const siteOf = new Map(sites.map((s) => [s.rivalId, s]));
  const day = (iso: string) => adminDate(timeZone, iso, "day", lang);
  const money = (minor: number, currency: string) => formatAmount(minor, currency, locale);
  const columns: Column<KeptOffer>[] = [
    { key: "rival", label: w.rival, cell: (o) => <span>{o.rivalName}</span> },
    {
      key: "page",
      label: w.page,
      cell: (o) => (
        <a href={o.address} target="_blank" rel="noopener noreferrer nofollow" className={linkClass}>
          {o.name || o.host}
        </a>
      ),
    },
    {
      key: "theirs",
      label: w.theirs,
      align: "right",
      cell: (o) => (
        <span className="flex flex-col items-end">
          <span className="tabular-nums">{money(o.priceMinor, o.currency)}</span>
          {/* The price before the last read that changed it (D900 M3), while that change is fresh. */}
          {o.previous && o.changedAt && offerFresh(o.changedAt, now) && o.previous.priceMinor !== o.priceMinor ? (
            <span className="text-xs text-muted tabular-nums">{fillWords(w.was, { price: money(o.previous.priceMinor, o.previous.currency) })}</span>
          ) : null}
        </span>
      ),
    },
    { key: "product", label: w.product, cell: (o) => (o.productId ? <span>{o.productName}</span> : <span className="text-muted">{w.noProduct}</span>) },
    { key: "yours", label: w.yours, align: "right", cell: (o) => (o.own ? <span className="tabular-nums">{money(o.own.priceMinor, o.own.currency)}</span> : <span className="text-muted">—</span>) },
    {
      key: "difference",
      label: w.difference,
      align: "right",
      cell: (o) => {
        const gap = priceGap(o.own, o);
        return gap === null ? <span className="text-muted">{w.notComparable}</span> : <span className="tabular-nums">{`${gap > 0 ? "+" : ""}${formatPercent(gap, 0)}`}</span>;
      },
    },
    {
      key: "read",
      label: w.readOn,
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-2">
          <span>{day(o.readAt)}</span>
          {offerFresh(o.readAt, now) ? null : <StatusPill tone="warning">{w.old}</StatusPill>}
        </span>
      ),
    },
  ];

  return (
    <AnalyticsSection id="market-rivals" title={w.title} description={w.description} level={3}>
      {rivals.length === 0 ? (
        <EmptyState compact title={sells ? w.none : w.noneSite} />
      ) : (
        <ul className={`divide-y divide-line ${CARD_CLASS}`} data-rivals>
          {rivals.map((r) => (
            <li key={r.id} data-rival={r.host} className="flex flex-col gap-1 px-4 py-3 text-sm">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusPill>{names.get(r.market) ?? r.market}</StatusPill>
                <span className="text-body-strong text-ink">{r.name}</span>
                <span className="text-muted">{r.host}</span>
                {actions ? (
                  <ActionForm action={actions.remove} className="ml-auto" successMessage={fillWords(w.removed, { name: r.name })}>
                    <input type="hidden" name="rival" value={r.id} />
                    <SubmitButton variant="secondary">
                      {w.remove}
                      <span className="sr-only">{` ${r.name}`}</span>
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </span>
              <SiteLine site={siteOf.get(r.id)} w={w.site} day={day} />
            </li>
          ))}
        </ul>
      )}

      {actions ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={actions.add} className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}>
            <Field label={w.country} required>
              {(control) => (
                <Select name="market" {...control} full defaultValue={countries[0]?.code}>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w.name} required>
              {(control) => <TextInput name="name" maxLength={120} autoComplete="off" full {...control} />}
            </Field>
            <Field label={w.address} required>
              {(control) => <TextInput name="address" inputMode="url" placeholder={w.addressHint} maxLength={300} autoComplete="off" full {...control} />}
            </Field>
            <div>
              <SubmitButton>{w.add}</SubmitButton>
            </div>
          </ActionForm>
          {sells && rivals.length > 0 ? (
            <ActionForm action={actions.read} className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}>
              <Field label={w.rival} required>
                {(control) => (
                  <Select name="rival" {...control} full>
                    {rivals.map((r) => (
                      <option key={r.id} value={r.id}>
                        {`${r.name} (${names.get(r.market) ?? r.market})`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={w.page} required>
                {(control) => <TextInput name="page" type="url" placeholder={w.pageHint} maxLength={2000} autoComplete="off" full {...control} />}
              </Field>
              <Field label={w.product}>
                {(control) => (
                  <Select name="product" {...control} full defaultValue="">
                    <option value="">{w.noProduct}</option>
                    {products.map((p) => (
                      <option key={p.handle} value={p.handle}>
                        {p.title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div>
                <SubmitButton>{w.read}</SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </div>
      ) : null}

      {services && rivals.length > 0 ? (
        <MarketServicePrices
          lang={lang}
          locale={locale}
          w={w.prices}
          per={services.per}
          prices={services.prices}
          rivals={rivals}
          currencies={services.currencies}
          products={products}
          actions={actions ? { keep: actions.keepPrice, remove: actions.removePrice } : null}
        />
      ) : null}
      {sells && offers.length > 0 ? <DataTable caption={w.caption} columns={columns} rows={offers} rowKey={(o) => o.id} exportable={false} exportReason="markets.rivals" /> : null}
    </AnalyticsSection>
  );
}
