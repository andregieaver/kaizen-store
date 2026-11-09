import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { platformCan, requireAccount } from "@/server/auth";
import { checkOwnerRole } from "@/server/permissions";
import { connectSlackWebhook } from "@/server/integrations";
import { connectPlatformSlack } from "@/server/platform-integrations";
import { PLATFORM_SLACK, SLACK_COOKIE, SLACK_COOKIE_PATH, SlackConnectError, slackStarted, slackWebhookFor } from "@/server/slack";

/** Back from Slack with the channel the owner picked for Kaizen's messages (D101), or a platform owner for Kaizena Flow's own (D515). */
export async function GET(request: Request) {
  const account = await requireAccount();
  const jar = await cookies();
  const cookie = jar.get(SLACK_COOKIE)?.value;
  jar.delete({ name: SLACK_COOKIE, path: SLACK_COOKIE_PATH });
  const params = new URL(request.url).searchParams;
  let started: { storeSlug: string; accountId: string };
  try {
    started = slackStarted(cookie, params);
  } catch {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  if (started.storeSlug === PLATFORM_SLACK) return platformCallback(request, params, account.id === started.accountId && platformCan(account, "settings") ? account : null);
  const back = (status: string) =>
    NextResponse.redirect(new URL(`/admin/${started.storeSlug}/integrations/slack?slack=${status}`, request.url));
  const member = started.accountId === account.id ? await checkOwnerRole(started.storeSlug) : null;
  if (!member) return back("failed");
  try {
    const webhook = await slackWebhookFor(params);
    const saved = await connectSlackWebhook(member, webhook);
    if (!saved.ok) return back("failed");
  } catch (error) {
    if (!(error instanceof SlackConnectError)) console.error("[slack]", error);
    return back(error instanceof SlackConnectError && error.reason === "cancelled" ? "cancelled" : "failed");
  }
  return back("connected");
}

/** Kaizena Flow's own channel (D515): only the platform owner who started it, back on Platform → Integrations → Slack. */
async function platformCallback(request: Request, params: URLSearchParams, admin: Awaited<ReturnType<typeof requireAccount>> | null) {
  const back = (status: string) => NextResponse.redirect(new URL(`/admin/platform/integrations/slack?slack=${status}`, request.url));
  if (!admin) return back("failed");
  try {
    const saved = await connectPlatformSlack(admin, await slackWebhookFor(params));
    return back(saved.ok ? "connected" : "failed");
  } catch (error) {
    return back(error instanceof SlackConnectError && error.reason === "cancelled" ? "cancelled" : "failed");
  }
}
