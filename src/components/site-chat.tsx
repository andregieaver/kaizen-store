import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { marketPath } from "@/lib/paths";
import { unitLabelsOf } from "@/lib/unit-price-text";
import { chatWidgetFor, type ChatWidgetProfile } from "@/server/chat-agent";
import { listPublishedPages } from "@/server/pages";
import type { Shop } from "@/server/shop";
import type { FrameEmbed } from "@/server/support-embeds";
import type { Store } from "@/server/stores";

import type { ChatLabels } from "./chat-widget";
import { ChatWidget, FrameChatWidget } from "./lazy/extras";

/** The widget's words in a language, with the agent's own greeting for the locale if it has one, for the desk's mode (D216). */
function chatLabels(lang: string, locale: string, profile: ChatWidgetProfile, deskName: string): ChatLabels {
  const m = t(lang);
  const c = m.chat;
  // The AI first with no AI set up answers as people only do (every conversation goes to the queue).
  const people = profile.mode === "people" || (profile.mode === "ai_first" && !profile.ai);
  return {
    open: c.open,
    close: c.close,
    aiAssistant: c.aiAssistant,
    greeting: people ? c.peopleGreeting(deskName) : profile.greeting[locale] || profile.greeting[lang] || c.greeting(profile.name),
    placeholder: c.placeholder,
    send: c.send,
    talk: c.talk,
    listening: c.listening,
    thinking: c.thinking,
    opened: c.opened("{label}"),
    sorry: c.sorry,
    disclaimer: c.disclaimer,
    micDenied: c.micDenied,
    restart: c.restart,
    conversation: c.conversation,
    notice: [
      profile.mode === "off" ? c.kept : people ? c.peopleNotice(deskName, profile.keptDays) : c.notice(profile.name, profile.keptDays),
      // What an AI does with the customer's messages besides answering (D391).
      ...(profile.aiUse.tone ? [c.aiUse.tone] : []),
      ...(profile.aiUse.summaries ? [c.aiUse.summaries] : []),
    ].join(" "),
    privacy: c.privacy,
    peopleTitle: c.peopleTitle,
    talkToPerson: c.talkToPerson,
    continueAssistant: c.continueAssistant,
    // The widget puts the place in: the message takes a number, and its English, hand-written or AI template writes what it is given.
    queuePlace: c.queuePlace("{place}" as unknown as number),
    nobody: c.nobody,
    nobodyLater: c.nobodyLater,
    translatedByAi: c.translatedByAi,
    rating: c.rating,
    emailCard: {
      intro: c.emailCard.intro,
      name: c.emailCard.name,
      email: c.emailCard.email,
      send: c.emailCard.send,
      sent: c.emailCard.sent("{email}"),
      use: c.emailCard.use,
      change: c.emailCard.change,
      invalid: c.emailCard.invalid,
    },
    lines: {
      ended: c.lines.ended,
      reopened: c.lines.reopened,
      queued: c.lines.queued,
      joined: c.lines.joined("{name}"),
      left: c.lines.left("{name}"),
      assistantBack: c.lines.assistantBack,
    },
    signInCard: { ...c.signInCard, codeSent: c.signInCard.codeSent("{email}") },
    actions: {
      confirm: c.actions.confirm,
      noThanks: c.actions.noThanks,
      expired: c.actions.expired,
      done: c.actions.done("{summary}"),
      failed: c.actions.failed("{reason}"),
      declined: c.actions.declined,
      requested: c.actions.requested("{summary}"),
      decidedDone: c.actions.decidedDone("{summary}"),
      decidedDeclined: c.actions.decidedDeclined("{summary}"),
      note: c.actions.note("{note}"),
      why: c.actions.why,
    },
    chips: {
      order: c.chips.order("{label}"),
      tracking: c.chips.tracking("{label}"),
      invoice: c.chips.invoice("{label}"),
      credit_note: c.chips.credit_note("{label}"),
      return: c.chips.return("{label}"),
      withdraw: c.chips.withdraw("{label}"),
      booking: c.chips.booking("{label}"),
      subscription: c.chips.subscription("{label}"),
      boxes: c.chips.boxes,
      bonus: c.chips.bonus,
      page: c.chips.page("{label}"),
    },
    newMessage: c.newMessage,
    vatIncluded: m.vatIncluded,
    vatExcluded: m.vatExcluded,
    fromPrice: m.fromPrice,
    priorPrice: m.priorPrice,
    priceOnRequest: m.quotes.priceOnRequest,
    unit: unitLabelsOf(m),
  };
}

/** The store's published privacy page, as the visitor's market reaches it, or undefined. */
async function privacyHref(store: Store, marketSlug: string): Promise<string | undefined> {
  const id = store.legalPages.privacy;
  if (!id) return undefined;
  const published = (await listPublishedPages(store.id)).find((page) => page.id === id);
  return published ? marketPath(store.slug, marketSlug, `/${published.slug}`) : undefined;
}

/** A store's chat (D81, D216), on its pages in one of its countries: the agent while it is on, or the desk while support is on. */
export async function StoreChat({ store, market }: { store: Store; market: Market }) {
  const profile = await chatWidgetFor(store.id);
  if (!profile) return null;
  return (
    <ChatWidget
      site={{ store: store.slug, market: market.slug }}
      signInHref={marketPath(store.slug, market.slug, "/account")}
      privacyHref={profile.mode === "off" ? undefined : await privacyHref(store, market.slug)}
      locale={market.locale}
      agent={profile}
      deskName={store.name}
      labels={chatLabels(market.lang, market.locale, profile, store.name)}
    />
  );
}

/**
 * The chat on a site of the owner's own (D581), drawn in its frame (`/embed/chat/{key}/{host}`): the store's desk in the market the owner
 * chose for the site, or Kaizena Flow's, with the site's own privacy page; its requests carry the site's key and the page's host.
 */
export async function FrameChat({ embed, shop, siteKey, host, path }: { embed: FrameEmbed; shop: Shop | null; siteKey: string; host: string; path: string }) {
  const profile = await chatWidgetFor(shop ? shop.store.id : null);
  if (!profile) return null;
  const embedded = { path, parentOrigin: `https://${host}` };
  const privacy = profile.mode === "off" ? undefined : (embed.privacyUrl ?? undefined);
  if (!shop) {
    const { locale, messages } = PLATFORM_LANG_FACTS.en;
    return (
      <FrameChatWidget site={{ embed: siteKey, host }} locale={locale} agent={profile} deskName="Kaizena Flow" privacyHref={privacy} labels={chatLabels(messages, locale, profile, "Kaizena Flow")} embedded={embedded} />
    );
  }
  const { store, market } = shop;
  return (
    <FrameChatWidget
      site={{ embed: siteKey, host }}
      locale={market.locale}
      agent={profile}
      deskName={store.name}
      privacyHref={privacy}
      labels={chatLabels(market.lang, market.locale, profile, store.name)}
      embedded={embedded}
    />
  );
}

/** Kaizen's own chat (D81, D216), on its pages: the agent while it is on, or the desk while support is on. */
export async function KaizenChat({ lang = "en" }: { lang?: PlatformLang }) {
  const profile = await chatWidgetFor(null);
  if (!profile) return null;
  const { locale, messages } = PLATFORM_LANG_FACTS[lang];
  return <ChatWidget site={{}} locale={locale} agent={profile} deskName="Kaizena Flow" labels={chatLabels(messages, locale, profile, "Kaizena Flow")} />;
}
