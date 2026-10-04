import { connection } from "next/server";

import { getAccount } from "@/server/auth";
import { checkPermission } from "@/server/permissions";

/**
 * Whether the visitor may edit the page they are on: Kaizen's pages (D42)
 * for platform admins, a store's pages (`?store=`, D54) for the members whose role can change the website.
 * Asked by the "Edit page" button only when the browser holds a session, so
 * pages themselves stay the same for everyone and cached.
 */
export async function GET(request: Request) {
  await connection();
  const store = new URL(request.url).searchParams.get("store");
  const editor = store ? Boolean(await checkPermission(store, "website:write")) : Boolean((await getAccount())?.platformAdmin);
  return Response.json({ editor }, { headers: { "Cache-Control": "private, no-store" } });
}
