import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { hint, tableShell, td, th } from "@/components/admin/data/ui";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { requireFeature } from "@/components/admin/feature-off";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StopSupplier, SupplierFormCard, SupplierProducts } from "@/components/admin/inventory/suppliers-view";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { countryName, supplierCountries } from "@/lib/drop-shipping";
import { inventoryPaths } from "@/lib/inventory-admin";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSupplierOrders } from "@/server/supplier-orders";
import { getDropShipSupplier, supplierVariants } from "@/server/suppliers";

import { markVariantsAction, saveSupplierAction, stopSupplierAction } from "../actions";

export const metadata: Metadata = { title: "Supplier" };

type Props = PageProps<"/admin/[store]/inventory/suppliers/[id]">;

/** One supplier that ships for the store (drop shipping, D550): its details, the products it sends and, for the owner, stopping it. Read per request. */
export default async function SupplierPage({ params, searchParams }: Props) {
  const { store: slug, id } = await params;
  const gated = await requirePermission(slug, "products:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory");
  const query = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} id={id} search={typeof query.q === "string" ? query.q.slice(0, 100) : ""} added={query.added === "1"} back={w.suppliers.back} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, id, search, added, back }: { storeSlug: string; id: string; search: string; added: boolean; back: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "inventory").suppliers;
  const supplier = await getDropShipSupplier(store.id, id);
  if (!supplier) notFound();
  const [variants, orders] = await Promise.all([supplierVariants(store.id, supplier.id, search), listSupplierOrders(store.id, supplier.id)]);
  const canWrite = memberCan(member, "products:write");
  const base = inventoryPaths(store.slug).suppliers;
  return (
    <AdminTextScope texts={adminTexts(lang, ["inventory"])}>
      <div className="flex flex-col gap-6">
        <InventoryHead slug={store.slug} active="suppliers" title={supplier.name} intro={`${fillWords(w.subtitle, { email: supplier.orderEmail, country: countryName(supplier.shipsFrom), days: countWords(supplier.dispatchDays, w.days) })}${supplier.outsideEu ? ` ${w.outsideEu}` : ""}`} lang={lang} back={{ href: base, label: back }} />
        {added && (
          <p role="status" className="text-sm">
            {fillWords(w.added, { name: supplier.name })}
          </p>
        )}
        <section className="flex flex-col gap-3" aria-labelledby="supplier-orders">
          <h2 id="supplier-orders" className="text-title text-ink">
            {w.ordersTitle}
          </h2>
          {orders.length === 0 ? (
            <p className={hint}>{w.ordersNone}</p>
          ) : (
            <div className={tableShell}>
              <table className="w-full text-sm">
                <caption className="sr-only">{w.ordersTitle}</caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className={th}>{w.order}</th>
                    <th scope="col" className={th}>{w.products}</th>
                    <th scope="col" className={th}>{w.state}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b border-line last:border-0">
                      <td className={`${td} font-medium`}>
                        <Link href={`/admin/${store.slug}/orders/${o.orderId}`} className="underline underline-offset-2">
                          {o.number}
                        </Link>
                      </td>
                      <td className={td}>{countWords(o.units, w.units)}</td>
                      <td className={td}>{fillWords(w.states[o.state], { problem: o.problem ?? "" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <SupplierProducts
          supplierId={supplier.id}
          supplierName={supplier.name}
          rows={variants}
          search={search}
          canWrite={canWrite}
          mark={markVariantsAction.bind(null, store.slug, supplier.id)}
        />
        {canWrite && (
          <SupplierFormCard
            id={supplier.id}
            initial={{
              name: supplier.name,
              orderEmail: supplier.orderEmail,
              shipsFrom: supplier.shipsFrom,
              orderLanguage: supplier.orderLanguage,
              dispatchDays: String(supplier.dispatchDays),
              orderMethod: supplier.orderMethod,
              returnAddress: supplier.returnAddress,
              orderNote: supplier.orderNote,
            }}
            countries={supplierCountries()}
            defaultCountry={supplier.shipsFrom}
            save={saveSupplierAction.bind(null, store.slug)}
            supplierBase={base}
          />
        )}
        <StopSupplier supplierName={supplier.name} isOwner={memberCan(member, "owner")} stop={stopSupplierAction.bind(null, store.slug, supplier.id)} back={base} />
      </div>
    </AdminTextScope>
  );
}
