import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { MethodEditor } from "@/components/admin/shipping/method-editor";
import { chosenMarket } from "@/components/admin/shipping/shipping-parts";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { METHODS_MAX } from "@/lib/shipping-limits";
import { memberCan, requirePermission } from "@/server/permissions";
import { getShippingSetup } from "@/server/shipping-methods";

import { deleteMethodAction, saveMethodAction } from "../../actions";

export const metadata: Metadata = { title: "Shipping method" };

/** A shipping method and its rate grid (D237 2.1); `new` with `?market=` makes one. */
export default async function ShippingMethodPage({ params, searchParams }: PageProps<"/admin/[store]/settings/shipping/methods/[methodId]">) {
  const { store: slug, methodId } = await params;
  const gated = await requirePermission(slug, "settings:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const all = adminText(lang, "shipping");
  const isNew = methodId === "new";
  if (!isNew && !z.uuid().safeParse(methodId).success) notFound();
  const setup = await getShippingSetup(store.id);
  const method = isNew ? null : (setup.methods.find((m) => m.id === methodId) ?? null);
  if (!isNew && !method) notFound();
  const market = method ? store.markets.find((m) => m.code === method.marketCode) : chosenMarket(store.markets, (await searchParams).market);
  // A method of a country the store no longer offers (D178) is kept but not shown here.
  if (!market) notFound();
  const base = `/admin/${store.slug}/settings/shipping`;
  const canWrite = memberCan(gated, "settings:write");
  const full = isNew && setup.methods.filter((m) => m.marketCode === market.code).length >= METHODS_MAX;
  return (
    <AdminTextScope texts={adminTexts(lang, ["shipping"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/methods?market=${market.code}`, label: fillWords(all.pages.methodsIn, { market: market.name }) }}
        title={method ? method.name : all.pages.newMethod}
        meta={[market.name, method?.currency ?? market.nativeCurrency]}
      />
      {full ? (
        <p className="text-sm text-muted">{fillWords(all.pages.methodsFull, { market: market.name, max: METHODS_MAX })}</p>
      ) : (
        <MethodEditor
          base={base}
          market={{ code: market.code, name: market.name, currency: method?.currency ?? market.nativeCurrency }}
          zones={setup.zones.filter((z) => z.marketCode === market.code).map((z) => ({ id: z.id, name: z.name }))}
          profiles={setup.profiles.map((p) => ({ id: p.id, name: p.name }))}
          method={method}
          canWrite={canWrite}
          save={saveMethodAction.bind(null, store.slug)}
        />
      )}
      {method && canWrite && (
        <DeleteDiscountButton
          action={deleteMethodAction.bind(null, store.slug, method.id, market.code)}
          code={method.name}
          question={fillWords(all.pages.deleteMethodQuestion, { name: method.name })}
          label={all.pages.deleteMethod}
        />
      )}
    </div>
    </AdminTextScope>
  );
}
