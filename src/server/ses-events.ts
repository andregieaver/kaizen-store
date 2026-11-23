import "server-only";

import { createVerify, X509Certificate } from "node:crypto";

import type { SesEnv } from "@/lib/env";
import { mailEventOf, readSnsMessage, snsCertUrlOk, snsStringToSign, snsSubscribeUrlOk, type SnsMessage } from "@/lib/ses";

import { applyEmailEvent } from "./email-events";
import { log } from "./log";

/**
 * Amazon SES's events about the marketing email it sent (D872), as SNS delivers them to `/api/ses/events`: delivered, bounced, marked as
 * spam, rejected. Only messages from the topic `AWS_SES_EVENTS_TOPIC_ARN` names, signed with SNS's own certificate, are trusted; each event
 * is recorded as Resend's are (`applyEmailEvent()`), so a hard bounce or a complaint takes the address off the store's list and the sending
 * guard (D730) counts it. The topic's subscription is confirmed here the first time SNS asks.
 */

/** Messages older than this are refused, so a captured one cannot be replayed later (SNS retries within the hour). */
const TOLERANCE_MS = 60 * 60 * 1000;

/** SNS's certificates by address: a few, kept while the function is warm. */
const certificates = new Map<string, string>();

async function certificate(url: string, fetcher: typeof fetch): Promise<string | null> {
  const kept = certificates.get(url);
  if (kept) return kept;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const pem = await response.text();
    const parsed = new X509Certificate(pem);
    // SNS's certificate names SNS.
    if (!/sns\.amazonaws\.com/.test(parsed.subject)) return null;
    if (certificates.size > 8) certificates.clear();
    certificates.set(url, pem);
    return pem;
  } catch {
    return null;
  }
}

/** What a check needs from outside, swapped in tests: the fetcher, the clock, and the key in place of SNS's certificate. */
export type SnsDeps = { fetcher?: typeof fetch; now?: number; key?: string };

/** Whether SNS signed the message, with its own certificate, recently. */
export async function verifySns(message: SnsMessage, deps: SnsDeps = {}): Promise<boolean> {
  if (!snsCertUrlOk(message.SigningCertURL)) return false;
  const algorithm = message.SignatureVersion === "1" ? "RSA-SHA1" : message.SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algorithm) return false;
  const at = Date.parse(message.Timestamp);
  if (!Number.isFinite(at) || Math.abs((deps.now ?? Date.now()) - at) > TOLERANCE_MS) return false;
  const pem = deps.key ?? (await certificate(message.SigningCertURL, deps.fetcher ?? fetch));
  if (!pem) return false;
  try {
    return createVerify(algorithm).update(snsStringToSign(message), "utf8").verify(pem, message.Signature, "base64");
  } catch {
    return false;
  }
}

export type Answer = { status: number; text: string };

/** One request from SNS: refused unless it is the topic's and signed; a subscription confirmed; an event recorded. */
export async function receiveSesEvent(body: string, ses: SesEnv | null, deps: SnsDeps = {}): Promise<Answer> {
  const fetcher = deps.fetcher ?? fetch;
  if (!ses?.topicArn) return { status: 503, text: "Not set up" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 400, text: "Invalid JSON" };
  }
  const message = readSnsMessage(parsed);
  if (!message) return { status: 400, text: "Not an SNS message" };
  if (message.TopicArn !== ses.topicArn) return { status: 403, text: "Unknown topic" };
  if (!(await verifySns(message, deps))) return { status: 400, text: "Invalid signature" };

  if (message.Type === "SubscriptionConfirmation") {
    if (!message.SubscribeURL || !snsSubscribeUrlOk(message.SubscribeURL, ses.topicArn)) return { status: 400, text: "Invalid subscription" };
    const confirmed = await fetcher(message.SubscribeURL, { signal: AbortSignal.timeout(5_000) }).then((r) => r.ok).catch(() => false);
    log(confirmed ? "info" : "warn", confirmed ? "ses.events_subscribed" : "ses.events_subscribe_failed", {});
    return confirmed ? { status: 200, text: "Subscribed" } : { status: 502, text: "Could not confirm" };
  }
  if (message.Type !== "Notification") return { status: 200, text: "Ignored" };

  let inner: unknown;
  try {
    inner = JSON.parse(message.Message);
  } catch {
    return { status: 200, text: "Ignored" };
  }
  const event = mailEventOf(inner);
  if (!event) return { status: 200, text: "Ignored" };
  try {
    await applyEmailEvent(event);
  } catch (error) {
    // SNS tries again with backoff.
    log("error", "ses.event_not_recorded", { type: event.type }, error);
    return { status: 500, text: "Could not record the event" };
  }
  return { status: 200, text: "Recorded" };
}
