import { redirect } from "next/navigation";

import { applyPlanDiscount, choosePlan } from "@/server/billing";
import { requireOwnerRole } from "@/server/permissions";
import { openPlanReminderLink } from "@/server/plan-reminders";

/**
 * A plan reminder's button (D33): for the store's owner, back to Stripe to
 * pay for the plan they chose, with the reminder's code if it has one;
 * a plan no longer offered lands on the Plan page. Only an owner may: the plan is theirs.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/billing/resume/[token]">) {
  const { store: storeSlug, token } = await params;
  const member = await requireOwnerRole(storeSlug);
  const billing = `/admin/${member.store.slug}/billing`;
  const found = token.length <= 64 ? await openPlanReminderLink(token) : null;
  if (!found || found.storeId !== member.store.id || !found.priceId) redirect(billing);
  const code = new URL(request.url).searchParams.get("code");
  if (code) await applyPlanDiscount(member.account, member.store.id, code.slice(0, 40));
  const chosen = await choosePlan(member.account, member.store.slug, found.priceId, new URL(request.url).origin);
  redirect(chosen.ok && chosen.checkoutUrl ? chosen.checkoutUrl : billing);
}
