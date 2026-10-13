import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { unitLabelsOf } from "@/lib/unit-price-text";
import { chatWidgetFor } from "@/server/chat-agent";
import type { Store } from "@/server/stores";

import type { ChatLabels } from "./chat-widget";
import { ChatWidget } from "./lazy/extras";

/** The widget's words in a language, with the agent's own greeting for the locale if it has one. */
function chatLabels(lang: string, locale: string, name: string, greeting: Record<string, string>): ChatLabels {
  const m = t(lang);
  const c = m.chat;
  return {
    open: c.open,
    close: c.close,
    aiAssistant: c.aiAssistant,
    greeting: greeting[locale] || greeting[lang] || c.greeting(name),
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
    kept: c.kept,
    lines: {
      ended: c.lines.ended,
      reopened: c.lines.reopened,
      queued: c.lines.queued,
      joined: c.lines.joined("{name}"),
      left: c.lines.left("{name}"),
      assistantBack: c.lines.assistantBack,
    },
    signIn: c.signIn,
    signInButton: c.signInButton,
    newMessage: c.newMessage,
    vatIncluded: m.vatIncluded,
    vatExcluded: m.vatExcluded,
    fromPrice: m.fromPrice,
    priorPrice: m.priorPrice,
    unit: unitLabelsOf(m),
  };
}

/** A store's chat agent (D81), on its pages in one of its countries, while it is on. */
export async function StoreChat({ store, market }: { store: Store; market: Market }) {
  const agent = await chatWidgetFor(store.id);
  if (!agent) return null;
  return (
    <ChatWidget
      site={{ store: store.slug, market: market.slug }}
      signInHref={marketPath(store.slug, market.slug, "/account")}
      locale={market.locale}
      agent={agent}
      labels={chatLabels(market.lang, market.locale, agent.name, agent.greeting)}
    />
  );
}

/** Kaizen's own chat agent (D81), on its pages, while it is on. */
export async function KaizenChat() {
  const agent = await chatWidgetFor(null);
  if (!agent) return null;
  return <ChatWidget site={{}} locale="en-GB" agent={agent} labels={chatLabels("en", "en-GB", agent.name, agent.greeting)} />;
}
