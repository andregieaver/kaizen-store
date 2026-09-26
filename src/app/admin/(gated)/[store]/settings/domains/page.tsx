import type { Metadata } from "next";

import { DomainsPanel } from "@/components/admin/domains-panel";
import { hostOrigin, storeBase, storeDomain, storeHref } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { checkWaitingDomains, deployIfBehind, listStoreDomains, routedAsSaved } from "@/server/domains";
import { domainsConfigured } from "@/server/vercel";

import { addDomainAction, checkDomainAction, primaryDomainAction, removeDomainAction } from "./actions";

export const metadata: Metadata = { title: "Domains" };

/** The store's addresses and its own domains (P7, P8). */
export default async function DomainsPage({ params }: PageProps<"/admin/[store]/settings/domains">) {
  const { store, role } = await requireMember((await params).store);
  const domain = storeDomain();
  if (!domain) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Domains</h1>
        <p className="max-w-2xl text-sm text-muted">
          Your store is at {storeHref(store.slug, storeBase(store.slug))} on Kaizen&apos;s own address for now. Stores get
          addresses of their own, and can use their own domains, once Kaizen&apos;s store domain is set up.
        </p>
      </div>
    );
  }
  // Waiting domains are checked as the owner looks; a deployment that did not happen is asked for again.
  await checkWaitingDomains(store.id);
  const domains = await listStoreDomains(store.id);
  const deploying = !routedAsSaved(store.slug, domains);
  if (deploying) await deployIfBehind(store.slug, domains).catch(() => false);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Domains</h1>
        <p className="max-w-2xl text-sm text-muted">
          Where shoppers find your store: its address on Kaizen, or a domain of your own.
        </p>
      </div>
      <DomainsPanel
        address={storeHref(store.slug, storeBase(store.slug))}
        hostAddress={hostOrigin(`${store.slug}.${domain.split(":")[0]}`)}
        domains={domains}
        deploying={deploying}
        owner={role === "owner"}
        configured={domainsConfigured()}
        actions={{
          add: addDomainAction.bind(null, store.slug),
          check: checkDomainAction.bind(null, store.slug),
          primary: primaryDomainAction.bind(null, store.slug),
          remove: removeDomainAction.bind(null, store.slug),
        }}
      />
    </div>
  );
}
