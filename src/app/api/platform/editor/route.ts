import { connection } from "next/server";

import { getAccount } from "@/server/auth";

/**
 * Whether the visitor may edit Kaizen's pages (D42). Asked by the "Edit
 * page" button on a page, only when the browser holds a session, so pages
 * themselves stay the same for everyone and cached.
 */
export async function GET() {
  await connection();
  const account = await getAccount();
  return Response.json(
    { editor: Boolean(account?.platformAdmin) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
