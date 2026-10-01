import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { CHECKOUT_COUNTRIES, CHECKOUT_PRICING } from "@/lib/delivery-options";
import { CARRIER_FEATURE_LABELS, carrierInfo } from "@/lib/shipping-carriers";
import { requireMember } from "@/server/auth";
import { CHECKOUT_SERVICES, getCheckoutSettings } from "@/server/delivery-options";
import { getShippingSettings } from "@/server/settings";
import { db } from "@/db/client";
import { getCarrier } from "@/server/shipping-carriers";

import { checkCarrierAction, removeCarrierAction, saveCarrierAction, saveCheckoutSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Shipping carrier" };

const card = "rounded-lg border border-border bg-background p-5";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/**
 * One shipping carrier (D133), prepared before its connection exists: what it will do for the store, how to get an
 * agreement and API access, and a form to save the store's own details now. Nothing is sent to the carrier yet.
 */
export default async function CarrierPage({ params }: PageProps<"/admin/[store]/integrations/shipping/[carrier]">) {
  const { store: slug, carrier } = await params;
  const { store, role } = await requireMember(slug);
  const info = carrierInfo(carrier);
  if (!info) notFound();
  const saved = await getCarrier(store.id, info.id);
  const owner = role === "owner";
  const live = info.available.length > 0;
  const marketCountries = [...new Set(store.markets.map((m) => m.code.toUpperCase()))];
  // Markets the store sells to, the carrier's first: the carrier can only deliver where it delivers.
  const offered = marketCountries.filter((code) => info.countries.includes(code));
  const chosen = new Set(saved?.countries ?? offered);
  // Delivery options at checkout (D135): what the store offers, next to its flat rate.
  const services = CHECKOUT_SERVICES[info.id];
  const checkout = services && saved?.complete ? await getCheckoutSettings(db(), store.id, info.id) : null;
  const flatRates = checkout ? await getShippingSettings(store) : [];
  const missingFlat = checkout ? flatRates.filter((r) => chosen.has(r.marketCode.toUpperCase()) && r.amountMinor === null).map((r) => r.marketCode) : [];
  const storePriced = CHECKOUT_PRICING[info.id] === "store";
  const pricedCountries = [...chosen].filter((code) => (CHECKOUT_COUNTRIES[info.id] ?? []).includes(code) && marketCountries.includes(code));
  const currencyFor = (code: string) => store.markets.find((m) => m.code.toUpperCase() === code)?.nativeCurrency ?? "NOK";
  const currencyOf = currencyFor("NO");
  const majorUnits = (minor: number | null) => (minor === null ? "" : (minor / 100).toFixed(2).replace(/\.00$/, "").replace(".", ","));
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/integrations`} className="text-sm underline">
          Integrations
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <IntegrationMark id={info.id} />
          <div>
            <h1 className="text-2xl font-semibold">{info.name}</h1>
            <p className="text-sm text-muted">
              {saved
                ? saved.complete
                  ? `Details saved ${when(saved.updatedAt)} · ${saved.environment === "live" ? "live" : "test"}${
                      live ? (saved.check?.ok ? " · connected" : saved.check ? " · not accepted by the carrier" : " · not checked yet") : " · waiting for the connection"
                    }`
                  : "Some details are still missing"
                : "Not set up"}
            </p>
          </div>
        </div>
      </div>

      {live ? (
        <p role="status" className="rounded-md bg-surface px-4 py-3 text-sm">
          The connection to {info.name} is ready. It can: {info.available.map((f) => CARRIER_FEATURE_LABELS[f].toLowerCase()).join("; ")}.
          {info.features.some((f) => !info.available.includes(f)) &&
            ` Still to come: ${info.features.filter((f) => !info.available.includes(f)).map((f) => CARRIER_FEATURE_LABELS[f].toLowerCase()).join("; ")}.`}
          {info.available.includes("labels") &&
            ` In the test environment ${info.name} books test shipments: nothing is shipped and orders are not marked as sent.`}
        </p>
      ) : (
        <p role="status" className="rounded-md bg-surface px-4 py-3 text-sm">
          The connection to {info.name} is being built. You can save your agreement details now, so it switches on for your
          store the day it arrives. Until then nothing is sent to {info.name} and your checkout and orders work as before.
        </p>
      )}

      <section aria-labelledby="will-do" className={card}>
        <h2 id="will-do" className="mb-2 font-medium">
          What it will do
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {info.features.map((feature) => (
            <li key={feature}>
              {CARRIER_FEATURE_LABELS[feature]}
              {live && <span className="text-muted"> · {info.available.includes(feature) ? "works now" : "coming next"}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          {info.summary} Delivers in {info.countries.join(", ")}.
        </p>
      </section>

      <section aria-labelledby="get-ready" className={card}>
        <h2 id="get-ready" className="mb-2 font-medium">
          Get ready
        </h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {info.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-3 text-sm">
          <a href={info.docs} target="_blank" rel="noopener noreferrer" className="underline">
            {info.name}&apos;s developer pages
          </a>
        </p>
      </section>

      <section aria-labelledby="details" className={card}>
        <h2 id="details" className="mb-1 font-medium">
          Your details
        </h2>
        {!owner && <p className="mb-3 text-sm text-muted">Only an owner of the store can change these.</p>}
        <p className="mb-4 text-sm text-muted">
          Kept encrypted on Kaizen&apos;s servers in Europe. Keys are never shown again after saving, only their last
          characters; leave a key empty to keep the one saved.
        </p>
        <ActionForm action={saveCarrierAction.bind(null, store.slug, info.id)} className="flex flex-col gap-4">
          <fieldset disabled={!owner} className="flex flex-col gap-4">
            <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
              Environment
              <select name="environment" defaultValue={saved?.environment ?? "test"} className={control}>
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </label>
            {info.fields.map((field) => {
              const hint = field.secret ? saved?.secrets[field.key] : undefined;
              return (
                <label key={field.key} className="flex max-w-md flex-col gap-1 text-sm font-medium">
                  {field.label}
                  {!field.required && <span className="font-normal text-muted">Optional</span>}
                  <input
                    name={`field:${field.key}`}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    defaultValue={field.secret ? "" : (saved?.details[field.key] ?? "")}
                    placeholder={hint ? `Saved ${hint}` : field.placeholder}
                    maxLength={200}
                    className={control}
                  />
                  {field.help && <span className="font-normal text-muted">{field.help}</span>}
                </label>
              );
            })}
            {marketCountries.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">Ship with {info.name} to</legend>
                {marketCountries.map((code) => {
                  const market = store.markets.find((m) => m.code.toUpperCase() === code);
                  const covered = info.countries.includes(code);
                  return (
                    <label key={code} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="countries" value={code} defaultChecked={chosen.has(code)} className="size-4" />
                      {market?.name ?? code}
                      {!covered && <span className="text-muted">({info.name} does not deliver here as far as we know)</span>}
                    </label>
                  );
                })}
              </fieldset>
            )}
            {owner && (
              <div>
                <SubmitButton>{saved ? "Save details" : "Save my details"}</SubmitButton>
              </div>
            )}
          </fieldset>
        </ActionForm>
      </section>

      {checkout && services && (
        <section aria-labelledby="checkout" className={card}>
          <h2 id="checkout" className="mb-1 font-medium">
            Delivery options at checkout
          </h2>
          <p className="mb-4 text-sm text-muted">
            Shoppers give their postal code at checkout and choose between your standard shipping and the services you switch on here,
            {storePriced
              ? ` at the prices you enter below (with VAT, as the shopper pays; ${info.name} has no price service, so use the prices in your agreement).`
              : ` with the price ${info.name} gives you plus VAT and what you add${info.id === "porterbuddy" ? ". Porterbuddy's windows are listed by date and time, each with its own price, for deliveries in Norway; a price Porterbuddy has made for shoppers to see already has VAT, so only your markup is added" : ". Posten / Bring's services are for parcels to Norway"}.`}{" "}
            If{" "}
            {info.name} does not answer, your standard shipping is used, so keep it set up under{" "}
            <Link href={`/admin/${store.slug}/settings/shipping`} className="underline">
              Shipping
            </Link>
            .
          </p>
          {missingFlat.length > 0 && (
            <p role="status" className="mb-4 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              No standard shipping price is set for {missingFlat.join(", ")}. Set one under Shipping: it is what the order starts with until the shopper chooses.
            </p>
          )}
          <ActionForm action={saveCheckoutSettingsAction.bind(null, store.slug, info.id)} className="flex flex-col gap-4">
            <fieldset disabled={!owner} className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="enabled" defaultChecked={checkout.enabled} className="size-4" />
                Offer {info.name} at checkout in the countries chosen above
              </label>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">Services to offer</legend>
                {services.map((service) => (
                  <label key={service.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="service" value={service.id} defaultChecked={checkout.services.includes(service.id)} className="size-4" />
                    {service.name}
                    {service.needsPickupPoint && <span className="text-muted">(the shopper chooses a pickup point)</span>}
                    {service.maxWeightGrams && <span className="text-muted">(parcels up to {service.maxWeightGrams / 1000} kg)</span>}
                  </label>
                ))}
                <p className="text-sm text-muted">A service is shown only when {info.name} offers it for the parcel and the postal code.</p>
              </fieldset>
              {storePriced && pricedCountries.length === 0 && (
                <p className="text-sm text-muted">Tick a country above and save the details first: prices are entered per country.</p>
              )}
              {storePriced &&
                pricedCountries.map((code) => (
                  <fieldset key={code} className="flex flex-col gap-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-sm font-medium">
                      {store.markets.find((m) => m.code.toUpperCase() === code)?.name ?? code} ({currencyFor(code)})
                    </legend>
                    {services.map((service) => (
                      <label key={service.id} className="flex items-center justify-between gap-3 text-sm">
                        <span>{service.name}</span>
                        <input
                          name={`price:${code}:${service.id}`}
                          inputMode="decimal"
                          defaultValue={majorUnits(checkout.prices[code]?.services[service.id] ?? null)}
                          placeholder="Not offered"
                          aria-label={`${service.name} price in ${code}`}
                          className={`${control} w-36`}
                        />
                      </label>
                    ))}
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Free when the basket is worth at least</span>
                      <input name={`freeOver:${code}`} inputMode="decimal" defaultValue={majorUnits(checkout.prices[code]?.freeOverMinor ?? null)} placeholder="Never free" className={`${control} w-36`} />
                    </label>
                  </fieldset>
                ))}
              <div className="grid gap-4 sm:grid-cols-2">
                {!storePriced && (
                  <>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Percentage added to the price with VAT
                  <input name="markupPercent" inputMode="numeric" defaultValue={String(checkout.markup.percent)} className={control} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Amount added ({currencyOf})
                  <input name="markupAmount" inputMode="decimal" defaultValue={majorUnits(checkout.markup.minor || null)} placeholder="0" className={control} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Free when the basket is worth at least ({currencyOf})
                  <input name="freeOver" inputMode="decimal" defaultValue={majorUnits(checkout.freeOverMinor)} placeholder="Never free" className={control} />
                </label>
                  </>
                )}
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Parcel weight when the goods have none (grams)
                  <input name="defaultWeight" inputMode="numeric" defaultValue={String(checkout.defaultWeightGrams)} className={control} />
                </label>
              </div>
              {owner && (
                <div>
                  <SubmitButton>Save checkout options</SubmitButton>
                </div>
              )}
            </fieldset>
          </ActionForm>
        </section>
      )}

      {live && owner && saved?.complete && (
        <section aria-labelledby="check" className={card}>
          <h2 id="check" className="mb-1 font-medium">
            Check connection
          </h2>
          <p className="mb-3 text-sm text-muted">
            Asks {info.name} whether it accepts your details. Nothing is booked.
            {saved.check && (
              <>
                {" "}
                Last checked {when(saved.check.at)}: {saved.check.ok ? "accepted." : (saved.check.message ?? "not accepted.")}
              </>
            )}
          </p>
          <ActionForm action={checkCarrierAction.bind(null, store.slug, info.id)}>
            <SubmitButton variant="secondary">Check connection</SubmitButton>
          </ActionForm>
        </section>
      )}

      {owner && saved && (
        <form action={removeCarrierAction.bind(null, store.slug, info.id)}>
          <button type="submit" className="text-sm underline">
            Forget my {info.name} details
          </button>
        </form>
      )}
    </div>
  );
}
