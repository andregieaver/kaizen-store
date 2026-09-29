import type { Metadata } from "next";

import { NewClientButton } from "@/components/admin/work/client-actions";
import { ClientsList } from "@/components/admin/work/clients-list";
import { WorkOff } from "@/components/admin/work/work-off";
import { OFFERABLE_CURRENCIES } from "@/lib/money";
import { parseClientListParams } from "@/lib/work-ui";
import { requireMember } from "@/server/auth";
import { listCountries } from "@/server/stores";
import { formDefaults, listClients } from "@/server/work";
import { sellerDetails } from "@/server/work-settings";

export const metadata: Metadata = { title: "Clients" };

/** Work's clients (D122): who the store bills, with their assignments and what is not yet invoiced. */
export default async function WorkClientsPage({ params, searchParams }: PageProps<"/admin/[store]/work/clients">) {
  const { store } = await requireMember((await params).store);
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Clients" />;
  const { show, query } = parseClientListParams(await searchParams);
  const [clients, defaults, countries, seller] = await Promise.all([
    listClients(store.id, { archived: show, search: query }),
    formDefaults(store),
    listCountries(),
    sellerDetails(store.id),
  ]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted">The people and companies you bill for your work.</p>
        </div>
        <NewClientButton
          storeSlug={store.slug}
          countries={countries.map(({ code, name }) => ({ code, name }))}
          currencies={[...OFFERABLE_CURRENCIES]}
          defaults={defaults}
          sellerCountry={seller.country}
        />
      </div>
      <ClientsList base={`/admin/${store.slug}/work`} clients={clients} query={query} show={show} />
    </div>
  );
}
