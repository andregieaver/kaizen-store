import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { requireFeature } from "@/components/admin/feature-off";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StopSupplier, SupplierFormCard, SupplierProducts } from "@/components/admin/inventory/suppliers-view";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { supplierCountries } from "@/lib/drop-shipping";
import { inventoryPaths } from "@/lib/inventory-admin";
import { memberCan, requirePermission } from "@/server/permissions";
import { getDropShipSupplier, supplierVariants } from "@/server/suppliers";

import { markVariantsAction, saveSupplierAction, stopSupplierAction } from "../actions";

export const metadata: Metadata = { title: "Supplier" };

type Props = PageProps<"/admin/[store]/inventory/suppliers/[id]">;

/** One supplier that ships for the store (drop shipping, D540): its details, the products it sends and, for the owner, stopping it. Read per request. */
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
        <Body storeSlug={store.slug} id={id} search={typeof query.q === "string" ? query.q.slice(0, 100) : ""} added={query.added === "1"} title={w.pages.suppliers.title} back={w.suppliers.back} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, id, search, added, title, back }: { storeSlug: string; id: string; search: string; added: boolean; title: string; back: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "inventory").suppliers;
  const supplier = await getDropShipSupplier(store.id, id);
  if (!supplier) notFound();
  const variants = await supplierVariants(store.id, supplier.id, search);
  const canWrite = memberCan(member, "products:write");
  const base = inventoryPaths(store.slug).suppliers;
  return (
    <AdminTextScope texts={adminTexts(lang, ["inventory"])}>
      <div className="flex flex-col gap-6">
        <InventoryHead slug={store.slug} active="suppliers" title={supplier.name} intro={supplier.outsideEu ? w.outsideEu : title} lang={lang} back={{ href: base, label: back }} />
        {added && (
          <p role="status" className="text-sm">
            {fillWords(w.added, { name: supplier.name })}
          </p>
        )}
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
