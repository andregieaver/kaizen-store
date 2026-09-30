import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { CARRIER_FEATURE_LABELS, carrierInfo } from "@/lib/shipping-carriers";
import { requireMember } from "@/server/auth";
import { getCarrier } from "@/server/shipping-carriers";

import { removeCarrierAction, saveCarrierAction } from "../actions";

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
  const marketCountries = [...new Set(store.markets.map((m) => m.code.toUpperCase()))];
  // Markets the store sells to, the carrier's first: the carrier can only deliver where it delivers.
  const offered = marketCountries.filter((code) => info.countries.includes(code));
  const chosen = new Set(saved?.countries ?? offered);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
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
                  ? `Details saved ${when(saved.updatedAt)} · ${saved.environment === "live" ? "live" : "test"} · waiting for the connection`
                  : "Some details are still missing"
                : "Not set up"}
            </p>
          </div>
        </div>
      </div>

      <p role="status" className="rounded-md bg-surface px-4 py-3 text-sm">
        The connection to {info.name} is being built. You can save your agreement details now, so it switches on for your
        store the day it arrives. Until then nothing is sent to {info.name} and your checkout and orders work as before.
      </p>

      <section aria-labelledby="will-do" className={card}>
        <h2 id="will-do" className="mb-2 font-medium">
          What it will do
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {info.features.map((feature) => (
            <li key={feature}>{CARRIER_FEATURE_LABELS[feature]}</li>
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
