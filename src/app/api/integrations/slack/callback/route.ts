import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getMembership, requireAccount } from "@/server/auth";
import { connectSlackWebhook } from "@/server/integrations";
import { SLACK_COOKIE, SLACK_COOKIE_PATH, SlackConnectError, slackStarted, slackWebhookFor } from "@/server/slack";

/** Back from Slack with the channel the owner picked for Kaizen's messages (D101). */
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
  const back = (status: string) =>
    NextResponse.redirect(new URL(`/admin/${started.storeSlug}/integrations/slack?slack=${status}`, request.url));
  const member = started.accountId === account.id ? await getMembership(started.storeSlug) : null;
  if (!member || member.role !== "owner") return back("failed");
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
