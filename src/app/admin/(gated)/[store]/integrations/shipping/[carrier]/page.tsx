import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { CHECKOUT_COUNTRIES, CHECKOUT_PRICING } from "@/lib/delivery-options";
import { carrierInfo } from "@/lib/shipping-carriers";
import { memberCan, requirePermission } from "@/server/permissions";
import { CHECKOUT_SERVICES, getCheckoutSettings } from "@/server/delivery-options";
import { getShippingSettings } from "@/server/settings";
import { db } from "@/db/client";
import { getCarrier } from "@/server/shipping-carriers";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { checkCarrierAction, removeCarrierAction, saveCarrierAction, saveCheckoutSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Shipping carrier" };

const card = "rounded-lg border border-line bg-card p-5";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * One shipping carrier (D133), prepared before its connection exists: what it will do for the store, how to get an
 * agreement and API access, and a form to save the store's own details now. Nothing is sent to the carrier yet.
 */
export default async function CarrierPage({ params }: PageProps<"/admin/[store]/integrations/shipping/[carrier]">) {
  const { store: slug, carrier } = await params;
  const current = await requirePermission(slug, "settings:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(current, "shop");
  if (shopOff) return shopOff;
  const { store } = current;
  const info = carrierInfo(carrier);
  if (!info) notFound();
  const saved = await getCarrier(store.id, info.id);
  const owner = memberCan(current, "owner");
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
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "shipping").carrier;
  // The carrier's own words in the admin's language (its summary, steps and fields), else as `CARRIERS` writes them.
  const own = w.carriers[info.id];
  const ownFields: Record<string, { label: string; help: string; placeholder: string }> = own.fields;
  const feature = (f: keyof typeof w.features) => w.features[f];
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/integrations`} className="text-sm underline">
          {w.integrations}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <IntegrationMark id={info.id} />
          <PageHeader
            title={<>{info.name}</>}
            description={
              <>
                {saved
                  ? saved.complete
                    ? `${fillWords(w.savedLine, { when: when(saved.updatedAt), environment: saved.environment === "live" ? w.live : w.test })}${live ? (saved.check?.ok ? w.connected : saved.check ? w.notAccepted : w.notChecked) : w.waiting}`
                    : w.missing
                  : w.notSetUp}
              </>
            }
          />
        </div>
      </div>

      {live ? (
        <p role="status" className="rounded-md bg-sunken px-4 py-3 text-sm">
          {fillWords(w.ready, { name: info.name, features: info.available.map((f) => feature(f).toLowerCase()).join("; ") })}
          {info.features.some((f) => !info.available.includes(f)) &&
            fillWords(w.toCome, { features: info.features.filter((f) => !info.available.includes(f)).map((f) => feature(f).toLowerCase()).join("; ") })}
          {info.available.includes("labels") && fillWords(w.testShipments, { name: info.name })}
        </p>
      ) : (
        <p role="status" className="rounded-md bg-sunken px-4 py-3 text-sm">
          {fillWords(w.building, { name: info.name })}
        </p>
      )}

      <section aria-labelledby="will-do" className={card}>
        <h2 id="will-do" className="mb-2 text-title text-ink">
          {w.willDo}
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {info.features.map((f) => (
            <li key={f}>
              {feature(f)}
              {live && <span className="text-muted"> · {info.available.includes(f) ? w.worksNow : w.comingNext}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          {own.summary} {fillWords(w.deliversIn, { countries: info.countries.join(", ") })}
        </p>
      </section>

      <section aria-labelledby="get-ready" className={card}>
        <h2 id="get-ready" className="mb-2 text-title text-ink">
          {w.getReady}
        </h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {own.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-3 text-sm">
          <a href={info.docs} target="_blank" rel="noopener noreferrer" className="underline">
            {fillWords(w.developerPages, { name: info.name })}
          </a>
        </p>
      </section>

      <section aria-labelledby="details" className={card}>
        <h2 id="details" className="mb-1 text-title text-ink">
          {w.details}
        </h2>
        {!owner && <p className="mb-3 text-sm text-muted">{w.ownerOnly}</p>}
        <p className="mb-4 text-sm text-muted">
          {w.kept}
        </p>
        <ActionForm action={saveCarrierAction.bind(null, store.slug, info.id)} className="flex flex-col gap-4">
          <fieldset disabled={!owner} className="flex flex-col gap-4">
            <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
              {w.environment}
              <select name="environment" defaultValue={saved?.environment ?? "test"} className={control}>
                <option value="test">{w.envTest}</option>
                <option value="live">{w.envLive}</option>
              </select>
            </label>
            {info.fields.map((field) => {
              const hint = field.secret ? saved?.secrets[field.key] : undefined;
              const words = ownFields[field.key];
              return (
                <label key={field.key} className="flex max-w-md flex-col gap-1 text-sm font-medium">
                  {words?.label || field.label}
                  {!field.required && <span className="font-normal text-muted">{w.optional}</span>}
                  <input
                    name={`field:${field.key}`}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    defaultValue={field.secret ? "" : (saved?.details[field.key] ?? "")}
                    placeholder={hint ? fillWords(w.savedHint, { hint }) : words?.placeholder || field.placeholder}
                    maxLength={200}
                    className={control}
                  />
                  {field.help && <span className="font-normal text-muted">{words?.help || field.help}</span>}
                </label>
              );
            })}
            {marketCountries.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{fillWords(w.shipTo, { name: info.name })}</legend>
                {marketCountries.map((code) => {
                  const market = store.markets.find((m) => m.code.toUpperCase() === code);
                  const covered = info.countries.includes(code);
                  return (
                    <label key={code} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="countries" value={code} defaultChecked={chosen.has(code)} className="size-4" />
                      {market?.name ?? code}
                      {!covered && <span className="text-muted">{fillWords(w.notCovered, { name: info.name })}</span>}
                    </label>
                  );
                })}
              </fieldset>
            )}
            {owner && (
              <div>
                <SubmitButton>{saved ? w.saveDetails : w.saveMyDetails}</SubmitButton>
              </div>
            )}
          </fieldset>
        </ActionForm>
      </section>

      {checkout && services && (
        <section aria-labelledby="checkout" className={card}>
          <h2 id="checkout" className="mb-1 text-title text-ink">
            {w.checkoutTitle}
          </h2>
          <p className="mb-4 text-sm text-muted">
            {w.checkoutStart}
            {storePriced
              ? fillWords(w.storePriced, { name: info.name })
              : fillWords(w.carrierPriced, { name: info.name, extra: info.id === "porterbuddy" ? w.porterbuddyExtra : w.bringExtra })}
            {fillWords(w.fallbackBefore, { name: info.name })}
            <Link href={`/admin/${store.slug}/settings/shipping`} className="underline">
              {w.shippingLink}
            </Link>
            {w.fallbackAfter}
          </p>
          {missingFlat.length > 0 && (
            <p role="status" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-text">
              {fillWords(w.missingFlat, { countries: missingFlat.join(", ") })}
            </p>
          )}
          <ActionForm action={saveCheckoutSettingsAction.bind(null, store.slug, info.id)} className="flex flex-col gap-4">
            <fieldset disabled={!owner} className="flex flex-col gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="enabled" defaultChecked={checkout.enabled} className="size-4" />
                {fillWords(w.offerAt, { name: info.name })}
              </label>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{w.services}</legend>
                {services.map((service) => (
                  <label key={service.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="service" value={service.id} defaultChecked={checkout.services.includes(service.id)} className="size-4" />
                    {service.name}
                    {service.needsPickupPoint && <span className="text-muted">{w.pickupPoint}</span>}
                    {service.maxWeightGrams && <span className="text-muted">{fillWords(w.upToKg, { kg: (service.maxWeightGrams / 1000).toLocaleString(ADMIN_LANG_FACTS[lang].locale) })}</span>}
                  </label>
                ))}
                <p className="text-sm text-muted">{fillWords(w.shownWhen, { name: info.name })}</p>
              </fieldset>
              {storePriced && pricedCountries.length === 0 && (
                <p className="text-sm text-muted">{w.tickFirst}</p>
              )}
              {storePriced &&
                pricedCountries.map((code) => (
                  <fieldset key={code} className="flex flex-col gap-2 rounded-md border border-line p-3">
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
                          placeholder={w.notOffered}
                          aria-label={fillWords(w.servicePrice, { service: service.name, country: code })}
                          className={`${control} w-36`}
                        />
                      </label>
                    ))}
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>{w.freeWhen}</span>
                      <input name={`freeOver:${code}`} inputMode="decimal" defaultValue={majorUnits(checkout.prices[code]?.freeOverMinor ?? null)} placeholder={w.neverFree} className={`${control} w-36`} />
                    </label>
                  </fieldset>
                ))}
              <div className="grid gap-4 sm:grid-cols-2">
                {!storePriced && (
                  <>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.percent}
                  <input name="markupPercent" inputMode="numeric" defaultValue={String(checkout.markup.percent)} className={control} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {fillWords(w.amount, { currency: currencyOf })}
                  <input name="markupAmount" inputMode="decimal" defaultValue={majorUnits(checkout.markup.minor || null)} placeholder="0" className={control} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {fillWords(w.freeWhenIn, { currency: currencyOf })}
                  <input name="freeOver" inputMode="decimal" defaultValue={majorUnits(checkout.freeOverMinor)} placeholder={w.neverFree} className={control} />
                </label>
                  </>
                )}
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.defaultWeight}
                  <input name="defaultWeight" inputMode="numeric" defaultValue={String(checkout.defaultWeightGrams)} className={control} />
                </label>
              </div>
              {owner && (
                <div>
                  <SubmitButton>{w.saveCheckout}</SubmitButton>
                </div>
              )}
            </fieldset>
          </ActionForm>
        </section>
      )}

      {live && owner && saved?.complete && (
        <section aria-labelledby="check" className={card}>
          <h2 id="check" className="mb-1 text-title text-ink">
            {w.checkTitle}
          </h2>
          <p className="mb-3 text-sm text-muted">
            {fillWords(w.checkText, { name: info.name })}
            {saved.check &&
              fillWords(w.lastChecked, { when: when(saved.check.at), result: saved.check.ok ? w.accepted : (saved.check.message ?? w.notAcceptedResult) })}
          </p>
          <ActionForm action={checkCarrierAction.bind(null, store.slug, info.id)}>
            <SubmitButton variant="secondary">{w.check}</SubmitButton>
          </ActionForm>
        </section>
      )}

      {owner && saved && (
        <form action={removeCarrierAction.bind(null, store.slug, info.id)}>
          <button type="submit" className="text-sm underline">
            {fillWords(w.forget, { name: info.name })}
          </button>
        </form>
      )}
    </div>
  );
}
