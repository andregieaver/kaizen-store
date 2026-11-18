import type { Metadata } from "next";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { NewDraftForm } from "@/components/admin/drafts/new-draft-form";
import { draftMarketOptions } from "@/lib/draft-markets";
import { memberCan, requirePermission } from "@/server/permissions";
import { getDeal } from "@/server/deals";
import { draftCustomerDetails } from "@/server/draft-orders";
import { fillWords } from "@/lib/drafts-words";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { createDraftAction } from "../actions";
import { dealsOn } from "@/lib/extensions";

export const metadata: Metadata = { title: "New draft order" };

/** Starts a draft order: choose the market (country, language, currency) it is priced in, then fill it in (wave 3, D173). `orders:read` opens the page; making the draft needs `orders:write`, which the action checks too. */
export default async function NewDraftPage({ params, searchParams }: PageProps<"/admin/[store]/orders/drafts/new">) {
  const member = await requirePermission((await params).store, "orders:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const options = draftMarketOptions(store.markets, store.localization);
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "drafts").pages;
  // A quote for a customer or a deal (ecosystem plan E2.6, D713): who it is for, read from the store's own rows, never from the address.
  const search = await searchParams;
  const uuid = (value: unknown) => (typeof value === "string" && z.uuid().safeParse(value).success ? value : undefined);
  const [customer, deal] = await Promise.all([
    uuid(search.customer) && memberCan(member, "customers:read") ? draftCustomerDetails(store.id, uuid(search.customer)!) : null,
    uuid(search.deal) && dealsOn(store) && memberCan(member, "customers:read") ? getDeal(store, uuid(search.deal)!) : null,
  ]);
  const forWhom = [customer ? customer.shippingAddress.name || customer.email : null, deal ? fillWords(w.forDeal, { title: deal.title }) : null].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/orders/drafts`, label: w.listTitle }} title={w.newTitle} description={w.newDescription} />
      {forWhom && <p className="text-sm" data-draft-for>{fillWords(w.forWhom, { who: forWhom })}</p>}
      {memberCan(member, "orders:write") ? (
        <AdminTextScope texts={adminTexts(lang, ["drafts"])}>
          <NewDraftForm
            options={options}
            action={createDraftAction.bind(null, store.slug)}
            defaultCountry={store.markets[0]?.code ?? ""}
            carry={{ ...(customer ? { customer: uuid(search.customer) } : {}), ...(deal ? { deal: deal.id } : {}) }}
          />
        </AdminTextScope>
      ) : (
        <p className="rounded-panel bg-sunken p-4 text-sm">{w.newNoWrite}</p>
      )}
    </div>
  );
}
