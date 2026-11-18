
import { missOrRedirect } from "@/server/redirect-resolve";
import { marketMoved, resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/[...rest]">;

/**
 * Every address of a market that no route matches (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.1, 5.3): `/no/collections/shoes`, `/no/products/old-cup`,
 * `/no/pages/about`, the shapes of an old shop. A manual redirect from it goes on for good, in the same market; anything else is the store's 404 page with the 404
 * status. It does not match a route that exists, so a live page is never looked up here, and a working page's address under a prefix (`/cart/x`) is only ever a 404.
 *
 * The name is `rest`, as the drawer slot's catch-all is: two catch-alls with other names are an ambiguous route and the build refuses them. The placeholder
 * `_` (Cache Components wants one static entry) is a plain 404, as the neighbours' placeholder is.
 */
export function generateStaticParams() {
  return [{ rest: ["_"] }];
}

export default async function MissingPage({ params }: Props) {
  const { store: storeSlug, market: marketSlug, rest } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  // A country, language or currency the store no longer offers moves to one it does, the rest of the address kept (D178).
  if (!shop) return marketMoved(storeSlug, marketSlug, `/${rest.join("/")}`);
  return missOrRedirect(shop, `/${rest.join("/")}`);
}
