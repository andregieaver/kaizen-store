import { redirect } from "next/navigation";

import { requireMember } from "@/server/auth";
import { applyPlanDiscount, choosePlan } from "@/server/billing";
import { openPlanReminderLink } from "@/server/plan-reminders";

/**
 * A plan reminder's button (D33): for the store's owner, back to Stripe to
 * pay for the plan they chose, with the reminder's code if it has one;
 * anyone else, or a plan no longer offered, lands on the Plan page.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/billing/resume/[token]">) {
  const { store: storeSlug, token } = await params;
  const member = await requireMember(storeSlug);
  const billing = `/admin/${member.store.slug}/billing`;
  const found = member.role === "owner" && token.length <= 64 ? await openPlanReminderLink(token) : null;
  if (!found || found.storeId !== member.store.id || !found.priceId) redirect(billing);
  const code = new URL(request.url).searchParams.get("code");
  if (code) await applyPlanDiscount(member.account, member.store.id, code.slice(0, 40));
  const chosen = await choosePlan(member.account, member.store.slug, found.priceId, new URL(request.url).origin);
  redirect(chosen.ok && chosen.checkoutUrl ? chosen.checkoutUrl : billing);
}
