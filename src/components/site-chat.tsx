import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { chatWidgetFor } from "@/server/chat-agent";
import type { Store } from "@/server/stores";

import { ChatWidget, type ChatLabels } from "./chat-widget";

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
    vatIncluded: m.vatIncluded,
    vatExcluded: m.vatExcluded,
    fromPrice: m.fromPrice,
    priorPrice: m.priorPrice,
  };
}

/** A store's chat agent (D81), on its pages in one of its countries, while it is on. */
export async function StoreChat({ store, market }: { store: Store; market: Market }) {
  const agent = await chatWidgetFor(store.id);
  if (!agent) return null;
  return (
    <ChatWidget
      site={{ store: store.slug, market: market.slug }}
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
