import type { Metadata } from "next";

import { OwnerClientsList } from "@/components/admin/work/owner-clients";
import { OwnerWorkStart } from "@/components/admin/work/owner-settings";
import { activeStoreSlug, defaultNewStore, parseStoreParam, scopeStores } from "@/lib/work-owner";
import { parseClientListParams } from "@/lib/work-ui";
import { requireAccount } from "@/server/auth";
import { getOwnerSettings, listOwnerClients, workStoresFor } from "@/server/work-owner";

import { switchActionsFor } from "../owner-page";
import { workText } from "@/lib/work-text";
import { workWords } from "@/server/work-words";

export const metadata: Metadata = { title: "Clients" };

/** The clients of all the account's stores (D123), searchable, with a store on every row and a store filter. */
export default async function OwnerClientsPage({ searchParams }: PageProps<"/admin/account/work/clients">) {
  await workWords();
  const tw = workText().pageClientsPage;
  const account = await requireAccount();
  const { using, off } = await workStoresFor(account);
  if (using.length === 0) {
    const rows = await getOwnerSettings(off);
    return <OwnerWorkStart title={tw.clients} rows={rows} actions={switchActionsFor(rows)} />;
  }
  const query = await searchParams;
  const { show, query: search } = parseClientListParams(query);
  const storeSlug = activeStoreSlug(using, parseStoreParam(query));
  const { clients, truncated } = await listOwnerClients(scopeStores(using, storeSlug), { archived: show, search });
  return (
    <OwnerClientsList
      stores={using}
      clients={clients}
      query={search}
      show={show}
      storeSlug={storeSlug}
      defaultStore={defaultNewStore(using, storeSlug)?.slug ?? ""}
      truncated={truncated}
    />
  );
}
