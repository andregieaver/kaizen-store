import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { buildBroadcastEmail, languageFor, type BroadcastContent, type EmailFacts } from "@/lib/broadcasts";
import { renderEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { t } from "@/lib/i18n";
import { marketUrl } from "@/lib/paths";
import { siteUrl } from "@/lib/site";

import { emailFactsFor } from "./broadcast-facts";
import { emailFooter, type EmailStore } from "./shopper-emails";

/**
 * One marketing email to one subscriber (D297 5.2, D298 6.3): the subscriber's language when the content has it, else the store's main one; links
 * under their market; the store's footer, the reason they get it and their own unsubscribe link, with `List-Unsubscribe` and
 * `List-Unsubscribe-Post`. A test (`token` null) links to the test page and carries no headers.
 */

export type MarketingEmail = { subject: string; html: string; text: string; headers?: Record<string, string> };

/** The market a subscriber's links go under: theirs while the store still has it, else the store's own. */
export function marketSlugFor(store: EmailStore, code: string | null): string {
  const market = (code && store.markets.find((m) => m.code === code)) || store.markets[0];
  return (market?.code ?? "").toLowerCase();
}

/** A store path made full under a market; a full address as written. */
export function resolverFor(store: EmailStore, marketSlug: string) {
  return (url: string) => (url.startsWith("/") ? marketUrl(store.slug, marketSlug, url) : url);
}

export function marketingEmail(input: {
  store: EmailStore;
  content: BroadcastContent;
  locale: string | null;
  marketCode: string | null;
  /** The subscriber's unsubscribe token; null for a test. */
  token: string | null;
  /** The address a link goes to in the email (a broadcast's click address); its target when left out. */
  link?: (key: string, target: string, marketSlug: string) => string;
  /** The products and campaigns the content names, as code read them for this subscriber (D352, `factsForEmail()`); none, left out. */
  facts?: EmailFacts;
}): MarketingEmail | null {
  const { store, token } = input;
  const main = store.localization.locales[0];
  const language = languageFor(input.content, input.locale, main);
  const content = input.content[language];
  if (!content) return null;
  const lang = language.slice(0, 2);
  const m = t(lang);
  const marketSlug = marketSlugFor(store, input.marketCode);
  const base = `${marketUrl(store.slug, marketSlug)}`;
  const email = renderEmail(
    buildBroadcastEmail({
      content,
      facts: input.facts,
      locale: language,
      footer: emailFooter(store, emailText(lang)),
      unsubscribe: { text: m.news.emailReason(store.name), linkText: m.news.unsubscribe, url: `${base}/unsubscribe/${token ?? "test"}` },
      resolve: resolverFor(store, marketSlug),
      link: (key, target) => (input.link ? input.link(key, target, marketSlug) : target),
    }),
  );
  return {
    ...email,
    headers: token ? { "List-Unsubscribe": `<${siteUrl()}/api/unsubscribe/${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
  };
}

/** The facts one subscriber's email draws (D352): the content's products and campaigns read in their market and the language they get. */
export function factsForEmail(store: EmailStore, content: BroadcastContent, locale: string | null, marketCode: string | null): Promise<EmailFacts> {
  const language = languageFor(content, locale, store.localization.locales[0]);
  return emailFactsFor(store, content, marketCode, language);
}

/** The pictures of the content that are not the store's own JPEG, PNG or GIF in its media library (5.1). */
export async function emailPictureProblem(storeId: string, content: BroadcastContent): Promise<string | null> {
  const urls = [...new Set(Object.values(content).flatMap((c) => c.blocks.flatMap((b) => (b.type === "image" ? [b.url] : []))))];
  if (urls.length === 0) return null;
  const rows = await db().execute<Record<string, unknown>>(sql`
    select url, content_type from commerce.media where store_id = ${storeId}::uuid and url in (select jsonb_array_elements_text(${JSON.stringify(urls)}::jsonb))
  `);
  const known = new Map(rows.map((r) => [String(r.url), String(r.content_type)]));
  for (const url of urls) {
    const type = known.get(url);
    if (!type) return "A picture is not in your media library. Upload it here.";
    if (!/^image\/(jpeg|png|gif)$/.test(type)) return "Pictures in emails must be JPEG, PNG or GIF: some mail apps cannot show WebP or AVIF. Upload the picture here.";
  }
  return null;
}

