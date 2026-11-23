import type { SendingRecord, SendingStatus } from "./sending-domains";

/**
 * Amazon SES for bulk marketing email (D748 section 10, D872), pure: the records SES asks of a sending domain, SES's answer about a domain
 * read into our shape, SES's events turned into the events the email log already knows, and the checks on an SNS message. The server
 * (`src/server/ses.ts`, `src/server/ses-events.ts`) only calls SES and writes what these work out.
 */

/**
 * The email kinds that go through SES while it is set up: what a store sends to its list (the sending guard's `MARKETING_KINDS`), never
 * what a shopper's order or account sends, which stays on Resend.
 */
export const SES_KINDS: readonly string[] = ["marketing.broadcast", "marketing.automation"];

/** The subdomain SES's bounces return to (its MAIL FROM), so SPF is the domain's own too; Resend's is `send.`. */
export const SES_MAIL_FROM_LABEL = "ses";

/** The MAIL FROM domain for a sending domain. */
export const sesMailFrom = (domain: string): string => `${SES_MAIL_FROM_LABEL}.${domain}`;

/** SES's DKIM states and the MAIL FROM's, read as a record's own word (`verified`, `pending`, `failed`), as the admin's card shows them. */
function word(status: unknown): string {
  if (status === "SUCCESS") return "verified";
  if (status === "FAILED") return "failed";
  return "pending";
}

export type SesIdentity = {
  /** SES lets the domain send. */
  verified: boolean;
  dkimStatus: string;
  tokens: string[];
  mailFromStatus: string;
};

const TOKEN = /^[a-z0-9]{16,64}$/;

/** SES's answer about one domain identity (create or get), or null when it is not one. */
export function readSesIdentity(body: unknown): SesIdentity | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const dkim = (b.DkimAttributes && typeof b.DkimAttributes === "object" ? b.DkimAttributes : {}) as Record<string, unknown>;
  const mailFrom = (b.MailFromAttributes && typeof b.MailFromAttributes === "object" ? b.MailFromAttributes : {}) as Record<string, unknown>;
  const tokens = (Array.isArray(dkim.Tokens) ? dkim.Tokens : []).filter((t): t is string => typeof t === "string" && TOKEN.test(t)).slice(0, 3);
  if (tokens.length === 0 && typeof b.VerifiedForSendingStatus !== "boolean") return null;
  return {
    verified: b.VerifiedForSendingStatus === true,
    dkimStatus: typeof dkim.Status === "string" ? dkim.Status : "PENDING",
    tokens,
    mailFromStatus: typeof mailFrom.MailFromDomainStatus === "string" ? mailFrom.MailFromDomainStatus : "PENDING",
  };
}

/** A domain's standing at SES: it sends once SES verified it; it failed when SES gave up on its DKIM records; it waits otherwise. */
export function sesStatusOf(identity: SesIdentity): SendingStatus {
  if (identity.verified && identity.dkimStatus === "SUCCESS") return "verified";
  if (identity.dkimStatus === "FAILED") return "failed";
  return "pending";
}

/**
 * The records SES asks of a domain, each with its own state: three DKIM CNAMEs (Easy DKIM, so mail is signed as the domain itself and
 * DMARC passes), and the MAIL FROM's MX and SPF, so bounces come back to SES from the domain's own subdomain.
 */
export function sesRecords(domain: string, region: string, identity: SesIdentity): SendingRecord[] {
  const mailFrom = sesMailFrom(domain);
  return [
    ...identity.tokens.map((token): SendingRecord => ({
      purpose: "DKIM",
      type: "CNAME",
      host: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com`,
      status: word(identity.dkimStatus),
    })),
    { purpose: "SPF", type: "MX", host: mailFrom, value: `feedback-smtp.${region}.amazonses.com`, priority: 10, status: word(identity.mailFromStatus) },
    { purpose: "SPF", type: "TXT", host: mailFrom, value: "v=spf1 include:amazonses.com ~all", status: word(identity.mailFromStatus) },
  ];
}

/** The event `applyEmailEvent()` takes, as Resend's webhook sends it. */
export type MailEvent = {
  type: "email.delivered" | "email.bounced" | "email.complained" | "email.failed";
  data: { email_id: string; bounce?: { type?: string; message?: string }; failed?: { reason?: string } };
};

/**
 * One SES event (a configuration set's event published to SNS) as the email log's event, or null for one it does not record (sent, opened,
 * clicked: we count clicks ourselves, D297). The SES message id is the email's provider reference, as Resend's id is for Resend's mail.
 */
export function mailEventOf(message: unknown): MailEvent | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const kind = typeof m.eventType === "string" ? m.eventType : typeof m.notificationType === "string" ? m.notificationType : "";
  const mail = (m.mail && typeof m.mail === "object" ? m.mail : {}) as Record<string, unknown>;
  const id = typeof mail.messageId === "string" ? mail.messageId.trim() : "";
  if (!id || id.length > 200) return null;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : undefined);
  switch (kind) {
    case "Delivery":
      return { type: "email.delivered", data: { email_id: id } };
    case "Bounce": {
      const bounce = (m.bounce && typeof m.bounce === "object" ? m.bounce : {}) as Record<string, unknown>;
      const first = Array.isArray(bounce.bouncedRecipients) ? (bounce.bouncedRecipients[0] as Record<string, unknown> | undefined) : undefined;
      // SES's `Permanent` is Resend's: only a hard bounce takes the address off the list.
      return { type: "email.bounced", data: { email_id: id, bounce: { type: text(bounce.bounceType), message: text(first?.diagnosticCode) ?? text(bounce.bounceSubType) } } };
    }
    case "Complaint":
      return { type: "email.complained", data: { email_id: id } };
    case "Reject":
    case "Rendering Failure": {
      const reason = m.reject && typeof m.reject === "object" ? text((m.reject as Record<string, unknown>).reason) : undefined;
      return { type: "email.failed", data: { email_id: id, failed: { reason: reason ?? kind } } };
    }
    default:
      return null;
  }
}

/** An SNS message as it arrives (JSON over HTTPS). */
export type SnsMessage = {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
};

/** Reads an SNS message, or null when a field it must carry is missing. */
export function readSnsMessage(body: unknown): SnsMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const need = ["Type", "MessageId", "TopicArn", "Message", "Timestamp", "SignatureVersion", "Signature", "SigningCertURL"] as const;
  if (!need.every((k) => typeof b[k] === "string" && b[k] !== "")) return null;
  const optional = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);
  return {
    ...(Object.fromEntries(need.map((k) => [k, b[k] as string])) as Pick<SnsMessage, (typeof need)[number]>),
    Subject: optional("Subject"),
    SubscribeURL: optional("SubscribeURL"),
    Token: optional("Token"),
  };
}

/** The text SNS signed, as its documentation lays it out: chosen fields as name and value lines, in this order. */
export function snsStringToSign(m: SnsMessage): string {
  const fields =
    m.Type === "Notification"
      ? (["Message", "MessageId", ...(m.Subject !== undefined ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"] as const)
      : (["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"] as const);
  return fields.map((k) => `${k}\n${(m as Record<string, string | undefined>)[k] ?? ""}\n`).join("");
}

/** Only SNS's own certificates are trusted: HTTPS on `sns.<region>.amazonaws.com`, a `.pem` path. */
export function snsCertUrlOk(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname) && u.pathname.endsWith(".pem") && !u.port;
  } catch {
    return false;
  }
}

/** A subscription's confirmation link is SNS's own, in the topic's region. */
export function snsSubscribeUrlOk(url: string, topicArn: string): boolean {
  try {
    const u = new URL(url);
    const region = topicArn.split(":")[3];
    return u.protocol === "https:" && u.hostname === `sns.${region}.amazonaws.com` && u.searchParams.get("Action") === "ConfirmSubscription";
  } catch {
    return false;
  }
}
