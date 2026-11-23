import "server-only";

import { sesEnv, type SesEnv } from "@/lib/env";
import { sesMailFrom } from "@/lib/ses";

import { signRequest } from "./aws-sigv4";
import type { Delivery } from "./email";
import { log } from "./log";

/**
 * Amazon SES in the EU for bulk marketing email (D748 section 10, D872): the only caller of SES's API. A domain identity is made for each
 * sending domain beside Resend's (Easy DKIM, a MAIL FROM on `ses.`), and broadcasts and flows go out through `SendEmail` while the sender's
 * domain is verified at SES; order emails stay on Resend (`email.ts`). Without `AWS_SES_*` nothing here is called.
 *
 * SES keeps no idempotency key, so an email whose call broke off without an answer is never sent again (`uncertain`): a reader may miss one
 * marketing email, never get it twice.
 */

/** SES's settings, or null when they are not set or not of the right shape (said once in the log, never thrown at a sender). */
export function sesSettings(): SesEnv | null {
  try {
    return sesEnv();
  } catch (error) {
    log("error", "ses.settings_invalid", {}, error);
    return null;
  }
}

type Call = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; code: string; message: string };

/** One signed call to SES's v2 API. */
async function ses(settings: SesEnv, method: string, path: string, body: unknown, fetcher: typeof fetch): Promise<Call> {
  const url = `https://email.${settings.region}.amazonaws.com${path}`;
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = signRequest(settings, { method, url, region: settings.region, service: "ses", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: text });
  try {
    const response = await fetcher(url, { method, headers, ...(body !== undefined && { body: text }), signal: AbortSignal.timeout(10_000) });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, body: answer };
    const code = String(response.headers.get("x-amzn-errortype") ?? answer.__type ?? answer.code ?? "").split(":")[0].replace(/^.*#/, "");
    const message = typeof answer.message === "string" ? answer.message : typeof answer.Message === "string" ? answer.Message : response.statusText;
    return { ok: false, status: response.status, code, message: message.slice(0, 300) };
  } catch (error) {
    return { ok: false, status: 0, code: "Network", message: error instanceof Error ? error.message.slice(0, 300) : "network error" };
  }
}

export type SesCall<T> = { ok: true; value: T } | { ok: false; status: number; problem: string };

/** SES's refusal in the staff's words. */
export function sesRefusal(call: Extract<Call, { ok: false }>): string {
  if (call.status === 403 || call.code === "AccessDeniedException") return "Kaizena Flow's SES key can't manage domains. A platform admin needs to give it SES's identity rights.";
  if (call.status === 0 || call.status >= 500) return "Amazon SES can't be reached just now. It is asked again tomorrow.";
  return `Amazon SES refused it: ${call.message}`;
}

const identityPath = (domain: string) => `/v2/email/identities/${encodeURIComponent(domain)}`;

/**
 * Makes the domain an identity at SES (Easy DKIM) with its MAIL FROM on `ses.`, and answers SES's view of it. A domain SES already has
 * (made before, or by a try that broke off) is read instead.
 */
export async function createSesIdentity(settings: SesEnv, domain: string, fetcher: typeof fetch = fetch): Promise<SesCall<Record<string, unknown>>> {
  const made = await ses(settings, "POST", "/v2/email/identities", { EmailIdentity: domain, ...(settings.configurationSet && { ConfigurationSetName: settings.configurationSet }) }, fetcher);
  if (!made.ok && made.code !== "AlreadyExistsException") return { ok: false, status: made.status, problem: sesRefusal(made) };
  const mailFrom = await ses(settings, "PUT", `${identityPath(domain)}/mail-from`, { MailFromDomain: sesMailFrom(domain), BehaviorOnMxFailure: "USE_DEFAULT_VALUE" }, fetcher);
  if (!mailFrom.ok) log("warn", "ses.mail_from_not_set", { status: mailFrom.status, code: mailFrom.code });
  return getSesIdentity(settings, domain, fetcher);
}

/** SES's view of a domain identity. */
export async function getSesIdentity(settings: SesEnv, domain: string, fetcher: typeof fetch = fetch): Promise<SesCall<Record<string, unknown>>> {
  const read = await ses(settings, "GET", identityPath(domain), undefined, fetcher);
  if (read.ok) return { ok: true, value: read.body };
  if (read.status === 404 || read.code === "NotFoundException") return { ok: false, status: 404, problem: "Amazon SES no longer has this domain. It is added again at the next check." };
  return { ok: false, status: read.status, problem: sesRefusal(read) };
}

/** Lets SES forget a domain; an identity it no longer has is fine. */
export async function deleteSesIdentity(settings: SesEnv, domain: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const gone = await ses(settings, "DELETE", identityPath(domain), undefined, fetcher);
  if (!gone.ok && gone.status !== 404 && gone.code !== "NotFoundException") {
    log("warn", "ses.identity_delete_failed", { status: gone.status, code: gone.code });
    return false;
  }
  return true;
}

/** A display name as a header carries it: RFC 2047 words when it is not plain ASCII (SES does not encode it itself). */
export function headerName(name: string): string {
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name}"`;
  return `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?=`;
}

export type SesMessage = {
  /** `{display name} <{address}>`'s two parts; the name already made safe (`senderName()`). */
  fromName: string;
  fromAddress: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Tags SES keeps with the email and its events: the kind and the store. */
  kind: string;
  storeId: string | null;
};

const TRIES = 3;

/** Words an email that may have gone out carries, never matched by a sender's "try again later" (`/network|abort|timeout/`). */
export const UNCERTAIN = "uncertain: SES may have sent it, so it is not sent again";

/**
 * One email through SES. Throttling (429) and SES's own failures (5xx) are tried again, briefly; a call that broke off without an answer
 * is not (`UNCERTAIN`), since SES may have sent it.
 */
export async function deliverSes(settings: SesEnv, message: SesMessage, fetcher: typeof fetch = fetch): Promise<Delivery> {
  const body = {
    FromEmailAddress: `${headerName(message.fromName)} <${message.fromAddress}>`,
    Destination: { ToAddresses: [message.to] },
    ...(message.replyTo && { ReplyToAddresses: [message.replyTo] }),
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: { Html: { Data: message.html, Charset: "UTF-8" }, Text: { Data: message.text, Charset: "UTF-8" } },
        ...(message.headers && Object.keys(message.headers).length > 0 && { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) }),
      },
    },
    EmailTags: [
      { Name: "kind", Value: message.kind.replace(/[^A-Za-z0-9_-]/g, "_") },
      { Name: "store", Value: message.storeId ?? "kaizen" },
    ],
    ...(settings.configurationSet && { ConfigurationSetName: settings.configurationSet }),
  };
  let error = "unknown";
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const sent = await ses(settings, "POST", "/v2/email/outbound-emails", body, fetcher);
    if (sent.ok && typeof sent.body.MessageId === "string") return { ok: true, id: sent.body.MessageId };
    if (sent.ok) return { ok: false, error: `${UNCERTAIN} (no message id)` };
    if (sent.status === 0) {
      log("warn", "ses.send_broke_off", { kind: message.kind, storeId: message.storeId });
      return { ok: false, error: UNCERTAIN };
    }
    error = `${sent.status} ${sent.code}: ${sent.message}`.slice(0, 500);
    if (sent.status !== 429 && sent.status < 500) break;
    if (attempt < TRIES - 1) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  return { ok: false, error };
}

/** Several emails through SES, a few at a time (SES's sending rate is per second); one result per email, in order. */
export async function deliverSesMany(settings: SesEnv, messages: readonly SesMessage[], fetcher: typeof fetch = fetch, together = 8): Promise<Delivery[]> {
  const out: Delivery[] = new Array(messages.length);
  let next = 0;
  const lane = async () => {
    while (next < messages.length) {
      const i = next++;
      out[i] = await deliverSes(settings, messages[i], fetcher);
    }
  };
  await Promise.all(Array.from({ length: Math.min(together, messages.length) }, lane));
  return out;
}
