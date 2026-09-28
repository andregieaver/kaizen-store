import "server-only";

import { randomBytes } from "node:crypto";

import { siteUrl } from "@/lib/site";

import { encryptionKey } from "./settings";

/**
 * "Add to Slack" (D101): Kaizen's own Slack app, with only the
 * `incoming-webhook` scope. The owner picks a channel in Slack, and Slack
 * gives Kaizen a webhook for it, which is kept like a pasted one. Kaizen
 * keeps no Slack token: it can post to that channel and nothing else.
 * Without the app's keys (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`), owners
 * paste a webhook they made themselves.
 */

const TIMEOUT_MS = 10_000;

export const SLACK_COOKIE = "kaizen_slack_connect";
export const SLACK_CALLBACK = "/api/integrations/slack/callback";
export const SLACK_COOKIE_PATH = "/api/integrations/slack";

type SlackApp = { clientId: string; clientSecret: string };

function slackApp(): SlackApp | null {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !encryptionKey()) return null;
  return { clientId, clientSecret };
}

/** Kaizen's Slack app is set up, so owners can add it to a channel. */
export const slackAppOn = () => slackApp() !== null;

/** Where the owner is sent to pick a channel, and what the callback must see again (kept in `kaizen_slack_connect`). */
export function slackStart(storeSlug: string, accountId: string): { url: string; cookie: string } | null {
  const app = slackApp();
  if (!app) return null;
  const state = randomBytes(24).toString("base64url");
  const params = new URLSearchParams({
    client_id: app.clientId,
    scope: "incoming-webhook",
    redirect_uri: `${siteUrl()}${SLACK_CALLBACK}`,
    state,
  });
  return { url: `https://slack.com/oauth/v2/authorize?${params}`, cookie: [state, storeSlug, accountId].join(".") };
}

export class SlackConnectError extends Error {
  constructor(
    message: string,
    readonly reason: "cancelled" | "failed" = "failed",
  ) {
    super(message);
  }
}

/** Who started connecting, from the cookie; checked against the state Slack sends back. */
export function slackStarted(cookie: string | undefined, params: URLSearchParams): { storeSlug: string; accountId: string } {
  const [state, storeSlug, accountId] = (cookie ?? "").split(".");
  if (!state || !storeSlug || !accountId || state !== params.get("state")) throw new SlackConnectError("The connection could not be checked.");
  return { storeSlug, accountId };
}

export type SlackWebhook = { url: string; channel: string; team: string };

/** The callback's code, exchanged for the channel's webhook. */
export async function slackWebhookFor(params: URLSearchParams): Promise<SlackWebhook> {
  const app = slackApp();
  if (!app) throw new SlackConnectError("Kaizen's Slack app is not set up here.");
  if (params.get("error")) throw new SlackConnectError(params.get("error") ?? "Cancelled", "cancelled");
  const code = params.get("code");
  if (!code) throw new SlackConnectError("Slack did not connect.");
  let body: Record<string, unknown>;
  try {
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
        redirect_uri: `${siteUrl()}${SLACK_CALLBACK}`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new SlackConnectError("Slack could not be reached.");
  }
  const webhook = body.incoming_webhook as Record<string, unknown> | undefined;
  if (body.ok !== true || typeof webhook?.url !== "string") {
    throw new SlackConnectError(typeof body.error === "string" ? body.error : "Slack gave no webhook.");
  }
  const team = body.team as Record<string, unknown> | undefined;
  return {
    url: webhook.url,
    channel: typeof webhook.channel === "string" ? webhook.channel : "",
    team: typeof team?.name === "string" ? team.name : "",
  };
}
