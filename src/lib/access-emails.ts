import type { EmailContent } from "./email-layout";
import { langOfLocale, PLATFORM_LANG_FACTS, type PlatformLang } from "./platform-lang";
import { platformText } from "./platform-text";

/**
 * Kaizena Flow's emails to someone who asked to open a store (D312 P6): the request received, approved and declined, in the language the
 * request was made in (`access_requests.locale`), from `platformText(lang).accessEmails`. They name the person and the store they asked
 * for, and nothing else of the request.
 */

export type AccessEmailKind = "received" | "approved" | "declined" | "confirm";

/** The language of a request's stored locale: English for none or one no longer offered. */
export const requestLang = (locale: string | null | undefined): PlatformLang => (locale ? (langOfLocale(locale) ?? "en") : "en");

/** The locale a request keeps for a language (`en`, `nb-NO`). */
export const requestLocale = (lang: PlatformLang): string => (lang === "en" ? "en" : PLATFORM_LANG_FACTS[lang].locale);

/** The same in every language: the name and the address. */
const FOOTER = ["Kaizena Flow · kaizenaflow.com"];

/** Each kind's `sendEmail()` kind, written out (`EMAIL_KINDS`). */
export const ACCESS_EMAIL_KINDS: Record<AccessEmailKind, string> = {
  received: "platform.access_received",
  approved: "platform.access_approved",
  declined: "platform.access_declined",
  confirm: "platform.access_confirm",
};

const fill = (text: string, values: { name: string; store: string }) => text.replaceAll("{name}", values.name).replaceAll("{store}", values.store);

export function accessEmail(kind: AccessEmailKind, lang: PlatformLang, input: { name: string; storeName: string; url?: string }): EmailContent {
  const w = platformText(lang).accessEmails;
  const values = { name: input.name.trim(), store: input.storeName.trim() };
  const head = { lang: PLATFORM_LANG_FACTS[lang].tag, footer: FOOTER };
  if (kind === "received") {
    const t = w.received;
    return {
      ...head,
      subject: fill(t.subject, values),
      preview: fill(t.preview, values),
      blocks: [
        { type: "heading", text: fill(t.heading, values) },
        { type: "paragraph", text: fill(t.body, values) },
        { type: "paragraph", text: t.nothing },
      ],
    };
  }
  if (kind === "approved") {
    const t = w.approved;
    return {
      ...head,
      subject: fill(t.subject, values),
      preview: fill(t.preview, values),
      blocks: [
        { type: "heading", text: fill(t.heading, values) },
        { type: "paragraph", text: fill(t.body, values) },
        ...(input.url ? [{ type: "button" as const, text: t.button, url: input.url }] : []),
      ],
    };
  }
  if (kind === "confirm") {
    // Self-serve sign-up (D359): the link opens a page with a button; nothing is made by opening it.
    const t = w.confirm;
    return {
      ...head,
      subject: fill(t.subject, values),
      preview: fill(t.preview, values),
      blocks: [
        { type: "heading", text: fill(t.heading, values) },
        { type: "paragraph", text: fill(t.body, values) },
        ...(input.url ? [{ type: "button" as const, text: t.button, url: input.url }] : []),
        { type: "paragraph", text: t.ignore },
      ],
    };
  }
  const t = w.declined;
  return {
    ...head,
    subject: fill(t.subject, values),
    preview: fill(t.preview, values),
    blocks: [
      { type: "heading", text: fill(t.heading, values) },
      { type: "paragraph", text: fill(t.body, values) },
    ],
  };
}
