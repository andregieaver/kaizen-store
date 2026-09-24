import { shareCard } from "@/lib/share-card";
import { getOpenStore } from "@/server/stores";

/** The store's share picture when the owner has not chosen one. */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/og.png">) {
  const store = await getOpenStore((await params).store);
  if (!store) return new Response("Not found", { status: 404 });
  return shareCard(store.name, store.markets.map((market) => market.name).join(" · "));
}
