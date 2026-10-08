import type { Metadata } from "next";
import Link from "next/link";

import { CountriesForm } from "@/components/admin/countries-form";
import { FeatureOffNote } from "@/components/admin/feature-off";
import { featureOn } from "@/lib/store-features";
import { memberCan, requirePermission } from "@/server/permissions";
import { listCountries } from "@/server/stores";

import { saveCountriesSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Countries" };

/**
 * The countries the store sells to (D178, `docs/store-features.md` 4d): its own country and, while Several countries is on, the others, each
 * with its own prices, shipping, language and currency. With the feature off the store sells in its own country alone; the others it keeps
 * stay on its list, with their prices and settings, for when the feature is on again.
 */
export default async function CountriesPage({ params }: PageProps<"/admin/[store]/settings/countries">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const owner = memberCan(current, "owner");
  const editor = memberCan(current, "settings:write");
  const several = featureOn(store, "countries");
  const countries = await listCountries();
  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const [home, ...others] = store.keptMarkets;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Countries</h1>
        <p className="text-sm text-muted">
          Each country gets its own storefront address, in its own language and currency, with its own prices and shipping. A product shows in a
          country once it has a price there.
        </p>
      </div>

      <section aria-labelledby="home-heading" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <h2 id="home-heading" className="text-base font-semibold">Your own country</h2>
        {home ? (
          <p className="text-sm">
            <strong>{nameOf(home.code)}</strong>, in {home.nativeCurrency}. It is your business&apos;s country under{" "}
            <Link href={`/admin/${store.slug}/settings/company`} className="underline">Company</Link> when you sell there, else the first
            country on your list. Amounts in reports are in its currency.
          </p>
        ) : (
          <p className="text-sm">The store sells to no country yet.</p>
        )}
        {!several && others.length > 0 && (
          <p className="text-sm text-muted">
            Kept for when Several countries is on again, with their prices and settings: {others.map((m) => nameOf(m.code)).join(", ")}.
          </p>
        )}
      </section>

      {!several && <FeatureOffNote storeSlug={store.slug} feature="countries" owner={owner} what="Selling in more than one country" />}

      <CountriesForm
        action={saveCountriesSettingsAction.bind(null, store.slug)}
        countries={countries}
        chosen={store.keptMarkets.map((m) => m.code)}
        several={several}
        submitLabel="Save countries"
        disabled={!editor}
        note={
          several ? (
            <p className="text-sm text-muted">A country taken off the list keeps its prices and settings, and comes back as it was when you add it again.</p>
          ) : (
            <p className="text-sm text-muted">Choosing another country makes it the only one on your list. The others keep their prices and settings, and come back as they were when you add them again.</p>
          )
        }
      />
      {!editor && <p className="text-sm">Your role may read the store&apos;s settings but not change them.</p>}
    </div>
  );
}
