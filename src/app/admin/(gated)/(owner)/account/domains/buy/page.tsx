import type { Metadata } from "next";
import { connection } from "next/server";

import { DomainCheckout } from "@/components/admin/domain-checkout";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requireAccount } from "@/server/auth";
import { domainsPublic } from "@/server/domain-purchases";

import { checkoutBuyAction, checkoutQuoteAction, checkoutSearchAction } from "./actions";

export const metadata: Metadata = { title: "Buy a domain" };

/** Buying a domain without a store (D317): where the email link from `/get-domain` lands, the name searched already. */
export default async function BuyDomainPage({ searchParams }: PageProps<"/admin/account/domains/buy">) {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const words = adminText(lang, "domains");
  const raw = (await searchParams).domain;
  const initial = typeof raw === "string" && /^[a-z0-9.-]{1,253}$/i.test(raw) ? raw.toLowerCase() : "";
  const [first = "", ...rest] = (account.name ?? "").trim().split(/\s+/);
  const back = { href: "/admin/account/domains", label: words.account.title };
  if (!(await domainsPublic())) return <PageHeader back={back} title={words.checkout.title} description={words.checkout.closed} />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={back} title={words.checkout.title} />
      <DomainCheckout
        words={words.checkout}
        get={words.get}
        locale={ADMIN_LANG_FACTS[lang].locale}
        initialQuery={initial}
        registrant={{ kind: "person", firstName: first, lastName: rest.join(" "), companyName: "", orgNumber: "", email: account.email, phone: "", address1: "", city: "", postalCode: "", country: "NO" }}
        actions={{ search: checkoutSearchAction, quote: checkoutQuoteAction, buy: checkoutBuyAction }}
      />
    </div>
  );
}
