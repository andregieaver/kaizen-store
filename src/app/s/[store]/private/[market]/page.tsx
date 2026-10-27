import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { RolePage } from "@/components/role-page";
import { marketHome } from "@/lib/paths";
import { resolveShop } from "@/server/shop";

import { PrivateSection } from "./private-section";

type Props = PageProps<"/s/[store]/private/[market]">;

/**
 * What a visitor without the pass sees of a private store (D339): the page chosen for the role `private`, built in the page builder, else
 * the standard one (the Password component alone). The proxy serves it in place of every other page; a store that is not private sends
 * whoever comes here to its home.
 */
export default function PrivatePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <PrivateRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function PrivateRoute({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  if (!store.privateMode) redirect(marketHome(store.slug, market.slug));
  return (
    <RolePage store={store} market={market} role="private" route={{ part: "private", query: searchParams }}>
      <PrivateSection store={store} market={market} query={searchParams} />
    </RolePage>
  );
}
