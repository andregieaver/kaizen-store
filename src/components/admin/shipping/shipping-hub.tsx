import Link from "next/link";
import type { ReactNode } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { shippingEn, type ShippingMessages } from "@/lib/admin-messages/shipping.en";
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
  /** The hub's words in the admin's language (D312 A8); English unless given. */
  words?: ShippingMessages["hub"];
};

/** A warning in words, naming the country (the AI manager's shipping tool reads it in English). */
export function warningWords(warning: ShippingWarning, marketName: (code: string) => string, words: ShippingMessages["hub"] = shippingEn.hub): string {
  const w = words.warnings;
  switch (warning.code) {
    case "no_flat_with_methods":
    case "zones_without_rest":
    case "subscriptions_need_flat":
      return fillWords(w[warning.code], { market: marketName(warning.marketCode) });
    case "default_weight_used":
      return countWords(warning.variants, w.default_weight_used);
  }
}

export function ShippingHubView({ base, markets, profiles, profiledProducts, defaultWeightGrams, pickup, local, warnings, flatRateForm, defaultWeightForm, words: w = shippingEn.hub }: ShippingHubProps) {
  const nameOf = (code: string) => markets.find((m) => m.code === code)?.name ?? code;
  return (
    <div className="flex flex-col gap-6">
      {warnings.length > 0 && (
        <section aria-labelledby="shipping-warnings" className="rounded-panel bg-warning-soft p-4 text-warning-text">
          <h2 id="shipping-warnings" className="text-body-strong">{w.needsLook}</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {warnings.map((warning, i) => (
              <li key={i}>{warningWords(warning, nameOf, w)}</li>
            ))}
          </ul>
        </section>
      )}

      <Card
        title={w.flatTitle}
        description={w.flatDescription}
      >
        {flatRateForm}
      </Card>

      <Card
        title={w.methodsTitle}
        description={w.methodsDescription}
      >
        <List label={w.methodsByCountry}>
          {markets.map((m) => (
            <ListRow key={m.code}>
              <RowLead title={m.name} href={`${base}/methods?market=${m.code}`} sub={m.currency} />
              <RowFact>{m.methods === 0 ? w.noMethods : `${countWords(m.activeMethods, w.offered)}${m.methods > m.activeMethods ? fillWords(w.off, { n: m.methods - m.activeMethods }) : ""}`}</RowFact>
              <RowFact>{countWords(m.zones, w.zones)}</RowFact>
              {!m.hasFlat && <Chip signal="warning">{w.noFlat}</Chip>}
            </ListRow>
          ))}
        </List>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title={w.zonesTitle}
          aside={<ButtonLink kind="link" href={`${base}/zones`}>{w.zonesTitle}</ButtonLink>}
          description={w.zonesDescription}
        >
          <p className="text-sm text-ink-2">{countWords(markets.reduce((n, m) => n + m.zones, 0), w.zonesInAll)}</p>
        </Card>
        <Card
          title={w.profilesTitle}
          aside={<ButtonLink kind="link" href={`${base}/profiles`}>{w.profilesTitle}</ButtonLink>}
          description={w.profilesDescription}
        >
          <p className="text-sm text-ink-2">
            {fillWords(w.profilesLine, { profiles: countWords(profiles, w.profiles), products: countWords(profiledProducts, w.products) })}
          </p>
        </Card>
        <Card
          title={w.pickupTitle}
          aside={<ButtonLink kind="link" href={`${base}/pickup`}>{w.pickupTitle}</ButtonLink>}
          description={w.pickupDescription}
        >
          <p className="text-sm text-ink-2">
            {pickup.places === 0 ? (
              <>
                {w.noPlacesBefore}
                <Link href={base.replace(/\/shipping$/, "/company")} className="underline">
                  {w.companyLink}
                </Link>
                {w.noPlacesAfter}
              </>
            ) : (
              countWords(pickup.active, w.offeredAt, { total: pickup.places })
            )}
          </p>
        </Card>
        <Card
          title={w.localTitle}
          aside={<ButtonLink kind="link" href={`${base}/local`}>{w.localTitle}</ButtonLink>}
          description={w.localDescription}
        >
          <p className="text-sm text-ink-2">{local.areas === 0 ? w.noAreas : countWords(local.active, w.areasOn, { total: local.areas })}</p>
        </Card>
      </div>

      <Card
        title={w.weightTitle}
        description={fillWords(w.weightDescription, { grams: defaultWeightGrams })}
      >
        {defaultWeightForm}
      </Card>

      <Card
        title={w.carriersTitle}
        aside={<ButtonLink kind="link" href={base.replace(/\/settings\/shipping$/, "/integrations")}>{w.integrations}</ButtonLink>}
        description={w.carriersDescription}
      />
    </div>
  );
}
