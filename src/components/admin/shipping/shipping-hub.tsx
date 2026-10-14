import Link from "next/link";
import type { ReactNode } from "react";

import type { ShippingWarning } from "@/lib/shipping-methods";
import { ButtonLink, Card, Chip, List, ListRow, RowFact, RowLead } from "@/components/admin/ui";

/**
 * The Shipping page, the section's hub (D237, `docs/wave-3-shipping-methods.md` 2.1): what needs a look first (`shippingWarnings()`, computed and
 * never stored), the flat rate per country (the default, and what is charged when no method fits), then one card each for methods, zones,
 * profiles, the default weight, pickup and local delivery, and the carriers. Presentational: the page reads, this draws.
 */

export type HubMarket = { code: string; name: string; currency: string; methods: number; activeMethods: number; zones: number; hasFlat: boolean };

export type ShippingHubProps = {
  base: string;
  markets: HubMarket[];
  profiles: number;
  /** Products in a profile other than General. */
  profiledProducts: number;
  defaultWeightGrams: number;
  pickup: { places: number; active: number };
  local: { areas: number; active: number };
  warnings: ShippingWarning[];
  /** The flat rate's form and the default weight's form, drawn by the page (they post to its actions). */
  flatRateForm: ReactNode;
  defaultWeightForm: ReactNode;
};

/** A warning in words, naming the country. */
export function warningWords(warning: ShippingWarning, marketName: (code: string) => string): string {
  switch (warning.code) {
    case "no_flat_with_methods":
      return `${marketName(warning.marketCode)}: there is no flat rate, so a basket no method prices cannot be bought.`;
    case "zones_without_rest":
      return `${marketName(warning.marketCode)}: no method has a rate for Rest of country, so addresses outside your zones cannot be served by a method.`;
    case "subscriptions_need_flat":
      return `${marketName(warning.marketCode)}: subscriptions and subscription boxes pay the flat rate, and none is set.`;
    case "default_weight_used":
      return `${warning.variants} ${warning.variants === 1 ? "variant has" : "variants have"} no weight and ${warning.variants === 1 ? "uses" : "use"} the default weight in weight tiers.`;
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ShippingHubView({ base, markets, profiles, profiledProducts, defaultWeightGrams, pickup, local, warnings, flatRateForm, defaultWeightForm }: ShippingHubProps) {
  const nameOf = (code: string) => markets.find((m) => m.code === code)?.name ?? code;
  return (
    <div className="flex flex-col gap-6">
      {warnings.length > 0 && (
        <section aria-labelledby="shipping-warnings" className="rounded-panel bg-warning-soft p-4 text-warning-text">
          <h2 id="shipping-warnings" className="text-body-strong">Needs a look</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {warnings.map((w, i) => (
              <li key={i}>{warningWords(w, nameOf)}</li>
            ))}
          </ul>
        </section>
      )}

      <Card
        title="Flat rate per country"
        description="The default shipping price, including VAT, and what is charged when no method below fits the basket. Subscriptions, subscription boxes and draft orders always pay it. Leave a country empty to have none; a basket nothing prices cannot be bought."
      >
        {flatRateForm}
      </Card>

      <Card
        title="Methods"
        description="Named ways of shipping in each country (Standard, Express …), priced flat, by weight or by basket value, per zone and per profile. Shoppers see the ones that price their basket, cheapest first."
      >
        <List label="Methods by country">
          {markets.map((m) => (
            <ListRow key={m.code}>
              <RowLead title={m.name} href={`${base}/methods?market=${m.code}`} sub={m.currency} />
              <RowFact>{m.methods === 0 ? "No methods: the flat rate is used" : `${count(m.activeMethods, "method", "methods")} offered${m.methods > m.activeMethods ? `, ${m.methods - m.activeMethods} off` : ""}`}</RowFact>
              <RowFact>{count(m.zones, "zone", "zones")}</RowFact>
              {!m.hasFlat && <Chip signal="warning">No flat rate</Chip>}
            </ListRow>
          ))}
        </List>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Zones"
          aside={<ButtonLink kind="link" href={`${base}/zones`}>Zones</ButtonLink>}
          description="Groups of postal codes inside a country with rates of their own. Codes in no zone are Rest of country."
        >
          <p className="text-sm text-ink-2">{count(markets.reduce((n, m) => n + m.zones, 0), "zone", "zones")} in all.</p>
        </Card>
        <Card
          title="Profiles"
          aside={<ButtonLink kind="link" href={`${base}/profiles`}>Profiles</ButtonLink>}
          description="Groups of products with rates of their own (bulky goods, fragile goods). Every other product is General."
        >
          <p className="text-sm text-ink-2">
            {count(profiles, "profile", "profiles")} besides General, with {count(profiledProducts, "product", "products")}.
          </p>
        </Card>
        <Card
          title="Pickup"
          aside={<ButtonLink kind="link" href={`${base}/pickup`}>Pickup</ButtonLink>}
          description="Let customers collect their order at one of your stores or pickup points, free or for a price."
        >
          <p className="text-sm text-ink-2">
            {pickup.places === 0 ? (
              <>
                No stores or pickup points yet. Add one under <Link href={base.replace(/\/shipping$/, "/company")} className="underline">Company</Link>.
              </>
            ) : (
              `Offered at ${count(pickup.active, "place", "places")} of ${pickup.places}.`
            )}
          </p>
        </Card>
        <Card
          title="Local delivery"
          aside={<ButtonLink kind="link" href={`${base}/local`}>Local delivery</ButtonLink>}
          description="Deliver yourself to customers nearby: areas by postal codes or a radius from a place, with a price, a minimum basket and a free-above value."
        >
          <p className="text-sm text-ink-2">{local.areas === 0 ? "No areas yet." : `${count(local.active, "area", "areas")} on, of ${local.areas}.`}</p>
        </Card>
      </div>

      <Card
        title="Default weight"
        description={`Used per unit for goods without a weight of their own, in methods' weight tiers (now ${defaultWeightGrams} g). Carriers have their own setting under Integrations.`}
      >
        {defaultWeightForm}
      </Card>

      <Card
        title="Carriers"
        aside={<ButtonLink kind="link" href={base.replace(/\/settings\/shipping$/, "/integrations")}>Integrations</ButtonLink>}
        description="Posten / Bring, PostNord, Porterbuddy and Helthjem: their services are offered at checkout next to your own methods, and you book and print labels from the order."
      />
    </div>
  );
}
