import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { card, hint } from "@/components/admin/data/ui";
import { requireFeature } from "@/components/admin/feature-off";
import { PassportEditor } from "@/components/admin/passport-editor";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { supplierCountries } from "@/lib/drop-shipping";
import { passportPath } from "@/lib/product-passport";
import { qrSvg } from "@/lib/qr";
import { siteUrl } from "@/lib/site";
import { memberCan, requirePermission } from "@/server/permissions";
import { passportForEdit } from "@/server/product-passports";

import { savePassportAction } from "./actions";

export const metadata: Metadata = { title: "Product passport" };

/** A product's Digital Product Passport (D554): its facts for staff who may change products, its state, and the code to print. Read per request. */
export default async function PassportAdminPage({ params }: PageProps<"/admin/[store]/products/[productId]/passport">) {
  const { store: slug, productId } = await params;
  const gated = await requirePermission(slug, "products:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const found = await passportForEdit(store.id, productId);
  if (!found) notFound();
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "products").passport;
  const address = found.id ? `${siteUrl()}${passportPath(found.id)}` : null;
  const svg = address ? qrSvg(address) : null;
  const dataUrl = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  return (
    <div className="flex flex-col gap-6">
      <Link href={`/admin/${store.slug}/products/${productId}`} className="text-sm text-muted underline underline-offset-2">
        {w.back}
      </Link>
      <PageHeader title={found.title ? `${w.title}: ${found.title}` : w.title} description={w.intro} />
      <p className="text-sm font-medium" data-passport-state={found.publishedAt ? "live" : "draft"}>
        {found.publishedAt ? w.live : w.draft}
      </p>
      {address && dataUrl && (
        <section className={`${card} flex flex-wrap items-center gap-4`} aria-labelledby="passport-code">
          {/* The code is an SVG drawn by `qrSvg()` from the passport's own address, shown as a picture so nothing in it runs. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt={w.code} width={160} height={160} className="rounded-md bg-white" />
          <div className="flex flex-col gap-2">
            <h2 id="passport-code" className="text-title text-ink">
              {w.code}
            </h2>
            <p className={`${hint} max-w-md`}>{w.codeHint}</p>
            <p className="break-all text-sm">{address}</p>
            <span className="flex flex-wrap gap-3 text-sm">
              <a href={dataUrl} download={`passport-${found.id}.svg`} className="underline underline-offset-2">
                {w.download}
              </a>
              {found.publishedAt && (
                <a href={address} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {w.open}
                </a>
              )}
            </span>
          </div>
        </section>
      )}
      <p className={`${hint} max-w-3xl`}>{w.sharedFacts}</p>
      {memberCan(gated, "products:write") && (
        <AdminTextScope texts={adminTexts(lang, ["products"])}>
          <PassportEditor initial={found.data} published={Boolean(found.publishedAt)} countries={supplierCountries()} save={savePassportAction.bind(null, store.slug, productId)} />
        </AdminTextScope>
      )}
    </div>
  );
}
