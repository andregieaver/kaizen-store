import type { Metadata } from "next";

import { DomainsPanel } from "@/components/admin/domains-panel";
import { hostOrigin, storeBase, storeDomain, storeHref } from "@/lib/paths";
import { memberCan, requirePermission } from "@/server/permissions";
import { checkWaitingDomains, deployIfBehind, listStoreDomains, routedAsSaved } from "@/server/domains";
import { domainsConfigured } from "@/server/vercel";
import { PageHeader } from "@/components/admin/ui";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { domainLanguages } from "@/lib/custom-domains";

import { addDomainAction, checkDomainAction, languageDomainAction, primaryDomainAction, removeDomainAction } from "./actions";

export const metadata: Metadata = { title: "Domains" };

/** The store's addresses and its own domains (P7, P8). */
export default async function DomainsPage({ params }: PageProps<"/admin/[store]/settings/domains">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const domain = storeDomain();
  if (!domain) {
    return (
      <PageHeader
        title="Domains"
        description={<>Your store is at {storeHref(store.slug, storeBase(store.slug))} on Kaizena Flow&apos;s own address for now. Stores get addresses of their own, and can use their own domains, once Kaizena Flow&apos;s store domain is set up.</>}
      />
    );
  }
  // Waiting domains are checked as the owner looks; a deployment that did not happen is asked for again.
  await checkWaitingDomains(store.id);
  const domains = await listStoreDomains(store.id);
  const deploying = !routedAsSaved(store.slug, domains);
  if (deploying) await deployIfBehind(store.slug, domains).catch(() => false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Domains" description={<>Where shoppers find your store: its address on Kaizena Flow, or a domain of your own.</>} />
      <DomainsPanel
        address={storeHref(store.slug, storeBase(store.slug))}
        hostAddress={hostOrigin(`${store.slug}.${domain.split(":")[0]}`)}
        domains={domains}
        deploying={deploying}
        owner={memberCan(current, "owner")}
        configured={domainsConfigured()}
        languages={domainLanguages(store, ADMIN_LANG_FACTS[lang].locale)}
        words={adminText(lang, "domains")}
        actions={{
          add: addDomainAction.bind(null, store.slug),
          check: checkDomainAction.bind(null, store.slug),
          primary: primaryDomainAction.bind(null, store.slug),
          remove: removeDomainAction.bind(null, store.slug),
          language: languageDomainAction.bind(null, store.slug),
        }}
      />
    </div>
  );
}
