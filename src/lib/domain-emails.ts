import type { EmailContent } from "./email-layout";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "./platform-lang";
import { platformText } from "./platform-text";

/**
 * Kaizena Flow's emails to a domain's holder (D315 9.1, D317): the registration made (with a consumer's consent repeated, as
 * `CONSENT_TEXT` promises), and a renewal that isn't paid or is switched off, at 30, 14, 7 and 1 days before expiry. Written in the holder's
 * admin language, from `platformText(lang).domainEmails`; they name the domain, the date and the holder, nothing else.
 */

export const REMINDER_DAYS = [30, 14, 7, 1] as const;

export type DomainEmailKind = "registered" | "unpaid" | "stopping";
export const DOMAIN_EMAIL_KINDS: Record<DomainEmailKind, string> = {
  registered: "domain.registered",
  unpaid: "domain.renewal_unpaid",
  stopping: "domain.renewal_stopping",
};

/** The reminder due on a day, if any: the largest of `REMINDER_DAYS` the days left have reached, so a missed day is still sent once. */
export function reminderDue(daysLeft: number): number | null {
  if (daysLeft < 0) return null;
  return [...REMINDER_DAYS].reverse().find((d) => daysLeft <= d) ?? null;
}

const fill = (text: string, values: Record<string, string>) => Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), text);

export function domainEmail(
  kind: DomainEmailKind,
  lang: PlatformLang,
  input: { domain: string; date: string; holder?: string; consent?: string | null; url: string },
): EmailContent {
  const t = platformText(lang).domainEmails[kind];
  const values = { domain: input.domain, date: input.date, holder: input.holder ?? "", consent: input.consent ?? "" };
  const consent = kind === "registered" && input.consent ? [{ type: "paragraph" as const, text: fill(platformText(lang).domainEmails.registered.consent, values) }] : [];
  return {
    lang: PLATFORM_LANG_FACTS[lang].tag,
    footer: ["Kaizena Flow · kaizenaflow.com"],
    subject: fill(t.subject, values),
    preview: fill(t.preview, values),
    blocks: [
      { type: "heading", text: fill(t.heading, values) },
      { type: "paragraph", text: fill(t.body, values) },
      ...consent,
      { type: "button", text: t.button, url: input.url },
    ],
  };
}
