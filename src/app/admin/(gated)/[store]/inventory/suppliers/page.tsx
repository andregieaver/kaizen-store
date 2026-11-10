import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { hint, tableShell, td, th } from "@/components/admin/data/ui";
import { requireFeature } from "@/components/admin/feature-off";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { SupplierFormCard } from "@/components/admin/inventory/suppliers-view";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { countryName, supplierCountries } from "@/lib/drop-shipping";
import { inventoryPaths } from "@/lib/inventory-admin";
import { memberCan, requirePermission } from "@/server/permissions";
import { listDropShipSuppliers } from "@/server/suppliers";

import { saveSupplierAction } from "./actions";

export const metadata: Metadata = { title: "Suppliers" };

type Props = PageProps<"/admin/[store]/inventory/suppliers">;

/**
 * Suppliers that ship for the store (drop shipping, D540, `docs/drop-shipping.md` 8): the list, and a short form to add one for staff who may change
 * products. Everyone who can read products sees the list. Read per request.
 */
export default async function SuppliersPage({ params }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory").pages.suppliers;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead slug={store.slug} active="suppliers" title={w.title} intro={w.intro} lang={lang} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "inventory").suppliers;
  const suppliers = await listDropShipSuppliers(store.id);
  const base = inventoryPaths(store.slug).suppliers;
  return (
    <AdminTextScope texts={adminTexts(lang, ["inventory"])}>
      <div className="flex flex-col gap-6">
        {suppliers.length === 0 ? (
          <p className="max-w-3xl text-sm text-muted">{w.none}</p>
        ) : (
          <div className={tableShell}>
            <table className="w-full text-sm">
              <caption className="sr-only">{w.caption}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={th}>{w.name}</th>
                  <th scope="col" className={th}>{w.shipsFrom}</th>
                  <th scope="col" className={th}>{w.dispatch}</th>
                  <th scope="col" className={th}>{w.products}</th>
                  <th scope="col" className={`${th} text-right`}>{w.stock}</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0" data-supplier={s.id}>
                    <td className={`${td} font-medium`}>
                      <Link href={`${base}/${s.id}`} aria-label={fillWords(w.open, { name: s.name })} className="underline underline-offset-2">
                        {s.name}
                      </Link>
                      <span className={`${hint} block`}>{s.orderEmail}</span>
                    </td>
                    <td className={td}>
                      {countryName(s.shipsFrom)}
                      {s.outsideEu && <span className={`${hint} block max-w-64`}>{w.outsideEu}</span>}
                    </td>
                    <td className={td}>{countWords(s.dispatchDays, w.days)}</td>
                    <td className={td}>{countWords(s.variants, w.variants)}</td>
                    <td className={`${td} text-right tabular-nums`}>{countWords(s.units, w.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {memberCan(member, "products:write") && (
          <SupplierFormCard
            id={null}
            countries={supplierCountries()}
            defaultCountry={store.details.country ?? store.markets[0]?.code ?? "NO"}
            save={saveSupplierAction.bind(null, store.slug)}
            supplierBase={base}
          />
        )}
        <p className={`${hint} max-w-3xl`}>{w.seller}</p>
      </div>
    </AdminTextScope>
  );
}
