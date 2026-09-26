import { connection } from "next/server";

import { faviconRedirect } from "@/lib/site-icons";
import { getOpenStore } from "@/server/stores";

/** A store's `/favicon.ico` on its own host (D62): its icon, or Kaizen's. */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/favicon.ico">) {
  await connection();
  const store = await getOpenStore((await params).store);
  return faviconRedirect(store?.navigation.favicon ?? null);
}
