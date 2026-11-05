import { connection } from "next/server";

import { sandboxStorefrontRequest } from "@/server/sandbox-storefront";

/** *See your store* (D457 S4): the sandbox's own storefront, opened for this browser alone once its pass opens the sandbox. */
export async function GET(request: Request, { params }: RouteContext<"/admin/try/[sandbox]/store">) {
  await connection();
  const { sandbox } = await params;
  return sandboxStorefrontRequest(request, sandbox);
}
