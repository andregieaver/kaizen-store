import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { hint } from "@/components/admin/data/ui";
import { CheckOldLinks, ShopifyConnectForm, ShopifyDisconnect } from "@/components/admin/moving/shopify-connect";
import { Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { momentText } from "@/lib/data-admin";
import { requireOwnerRole } from "@/server/permissions";
import { shopifyConnection, shopifyCounts, shopifyOffered } from "@/server/shopify-connect";

import { checkOldLinksAction, connectShopifyAction, disconnectShopifyAction } from "./actions";

export const metadata: Metadata = { title: "Moving in" };

type Props = PageProps<"/admin/[store]/settings/moving">;

const OUTCOMES = ["connected", "declined", "failed", "off"] as const;

/**
 * Settings → Moving in (D445 step 2, `docs/moving-from-shopify.md` 4.2): for Homer, one field and *Connect Shopify*; once connected, the
 * shop's name and what it holds, and one press to check its old links. Until copying is built (step 3), the files that bring the rest
 * over are linked in their order. Without Kaizena Flow's Shopify app set on this server, the files alone. The owner's.
 */
export default async function MovingPage({ params, searchParams }: Props) {
  const { store, account } = await requireOwnerRole((await params).store);
  const w = adminText(adminLangOf(account.adminLocale), "moving");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requireOwnerRole(storeSlug);
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "moving");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const asked = (await searchParams).shopify;
  const outcome = OUTCOMES.find((o) => o === asked) ?? null;
  const offered = shopifyOffered();
  const connection = offered ? await shopifyConnection(member) : null;
  const counts = connection ? await shopifyCounts(member) : null;
  const base = `/admin/${store.slug}`;
  const files = [
    { href: `${base}/products/import`, label: w.files.products },
    { href: `${base}/customers/import`, label: w.files.customers },
    { href: `${base}/orders/history-import`, label: w.files.orders },
    { href: `${base}/redirects/old-shop`, label: w.files.links },
  ];
  const fileList = (
    <ol className="list-decimal pl-5 text-sm">
      {files.map((f) => (
        <li key={f.href}>
          <Link href={f.href} className="underline underline-offset-2">
            {f.label}
          </Link>
        </li>
      ))}
    </ol>
  );
  const n = (v: number | null) => (v === null ? "–" : v.toLocaleString(locale));

  return (
    <AdminTextScope texts={adminTexts(lang, ["moving"])}>
      {outcome && (
        <p role="status" className={`rounded-card p-3 text-sm ${outcome === "connected" ? "bg-positive-soft" : "bg-sunken"}`}>
          {w.outcome[outcome]}
        </p>
      )}
      {!offered ? (
        <Card title={w.off.title} description={w.off.text}>
          {fileList}
        </Card>
      ) : connection ? (
        <Card title={fillWords(w.connected.title, { name: connection.name || connection.shop })} description={fillWords(w.connected.shop, { shop: connection.shop, when: momentText(connection.connectedAt, store.timeZone, locale) })}>
          <div className="flex flex-col gap-4">
            {counts && (
              <div>
                <p className="text-sm">{fillWords(w.connected.counts, { products: n(counts.products), customers: n(counts.customers), orders: n(counts.orders) })}</p>
                <p className={hint}>{w.connected.countsAtLeast}</p>
              </div>
            )}
            {connection.missing.length > 0 && (
              <p role="alert" className="text-sm">
                {countWords(connection.missing.length, w.connected.missing, { n: connection.missing.length })}
              </p>
            )}
            <CheckOldLinks check={checkOldLinksAction.bind(null, store.slug)} />
            <div className="flex flex-col gap-2">
              <p className="text-sm">{w.connected.copySoon}</p>
              {fileList}
            </div>
            <ShopifyDisconnect disconnect={disconnectShopifyAction.bind(null, store.slug)} />
          </div>
        </Card>
      ) : (
        <Card title={w.connect.title}>
          <ShopifyConnectForm connect={connectShopifyAction.bind(null, store.slug)} />
        </Card>
      )}
    </AdminTextScope>
  );
}
