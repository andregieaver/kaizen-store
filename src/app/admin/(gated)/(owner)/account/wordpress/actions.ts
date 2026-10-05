"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { approvalLocation, readApproval } from "@/lib/wordpress";
import { audit, requireAccount } from "@/server/auth";
import { revokeConnection, startApproval } from "@/server/wordpress";

/**
 * The owner's yes or no to a WordPress site's request (D169). The request comes back from the page's hidden fields and is read again
 * with the same rules, so a changed field is refused; the answer goes to the site's own return address and nowhere else.
 */
export async function answerApprovalAction(formData: FormData): Promise<void> {
  const account = await requireAccount();
  const read = readApproval(Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])));
  if (!read.ok) redirect("/admin/account/wordpress");
  if (formData.get("answer") !== "approve") redirect(approvalLocation(read.request, { error: "denied" }));
  const code = await startApproval(account.id, read.request);
  await audit(account.id, null, "account.wordpress_approved", { site: read.request.site });
  redirect(approvalLocation(read.request, { code }));
}

/** Ends a connection from the list: the site's next call is refused. */
export async function revokeConnectionAction(connectionId: string): Promise<void> {
  const account = await requireAccount();
  if (await revokeConnection(account.id, connectionId)) await audit(account.id, null, "account.wordpress_revoked", { connection: connectionId });
  refresh();
}
