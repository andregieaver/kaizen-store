import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataSkeleton } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { greenClaimsReport } from "@/server/green-claims";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Environmental claims" };

type Props = PageProps<"/admin/[store]/products/claims">;

const LIMIT = 300;

/**
 * Environmental claims on the live site (D552): every vague environmental claim in the store's active products, published pages and articles, with
 * the words around it and a link to where it is written. Read per request; it changes nothing. Everyone who can read products sees it.
 */
export default async function GreenClaimsPage({ params }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "products").greenClaims;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={gated.store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const w = adminText(adminLangOf(member.account.adminLocale), "products").greenClaims;
  const { places, claims } = await greenClaimsReport(store.id, LIMIT);
  const editPath = (kind: string, id: string) => (kind === "product" ? `/admin/${store.slug}/products/${id}` : `/admin/${store.slug}/pages/${id}`);
  if (places.length === 0) return <p className={`${card} text-sm`}>{w.none}</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium" data-green-claims={claims}>
        {countWords(claims, w.count)}
      </p>
      <p className={`${hint} max-w-3xl`}>{w.how}</p>
      <div className={tableShell}>
        <table className="w-full text-sm">
          <caption className="sr-only">{w.title}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={th}>{w.kinds.product}</th>
              <th scope="col" className={th}>{w.title}</th>
              <th scope="col" className={th}>
                <span className="sr-only">{w.edit}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {places.map((place, i) => (
              <tr key={`${place.id}:${place.where}:${i}`} className="border-b border-line last:border-0">
                <td className={td}>
                  <span className="font-medium">{place.title || w.untitled}</span>
                  <span className={`${hint} block`}>
                    {w.kinds[place.kind]}
                    {place.where ? ` · ${place.where}` : ""}
                  </span>
                </td>
                <td className={td}>
                  <ul className="flex flex-col gap-2">
                    {place.findings.map((f, j) => (
                      <li key={j}>
                        <strong>{f.phrase}</strong>
                        <span className={`${hint} block`}>{f.excerpt}</span>
                        {f.offset && <span className="block text-xs text-danger-text">{w.offset}</span>}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className={`${td} text-right`}>
                  <Link href={editPath(place.kind, place.id)} className="underline underline-offset-2">
                    {w.edit}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {claims >= LIMIT && <p className={hint}>{fillWords(w.more, { n: LIMIT })}</p>}
    </div>
  );
}
