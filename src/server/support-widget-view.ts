import "server-only";

import { chatLabels } from "@/components/site-chat";
import { t } from "@/lib/i18n";
import { PLATFORM_LANG_FACTS } from "@/lib/platform-lang";
import { themeCss } from "@/lib/theme";

import { chatWidgetFor } from "./chat-agent";
import type { Store } from "./stores";
import type { SupportWidget } from "./support-widgets";

/** Kaizena Flow's own chat colours, as its site draws them (globals.css, light). */
const KAIZEN = { accent: "#171717", background: "#ffffff", text: "#171717" };
const KAIZEN_CSS = `.kz-widget-preview { --background: #ffffff; --foreground: #171717; --muted: #525252; --surface: #f5f5f4; --border: #e5e5e5; --accent: #171717; --accent-foreground: #ffffff; --button-radius: 9999px; }`;

/**
 * What a widget's preview in the admin is drawn with (D581): the store's theme in its light colours on the preview's box, the colours the
 * pickers show until the owner chooses their own, and the chat's own words in the widget's language (the desk's greeting, as the chat
 * shows it in its mode). Kaizena Flow's desk (`store` null) in its own site's colours, in English.
 */
export async function widgetPreviewOf(store: Store | null, widget: SupportWidget | null) {
  const profile = await chatWidgetFor(store?.id ?? null);
  if (!store) {
    const { locale, messages } = PLATFORM_LANG_FACTS.en;
    const m = t("en").chat;
    const words = profile ? chatLabels(messages, locale, profile, "Kaizena Flow") : null;
    return {
      themeCss: KAIZEN_CSS,
      colours: KAIZEN,
      labels: { deskName: "Kaizena Flow", open: words?.open ?? m.open, greeting: words?.greeting ?? m.peopleGreeting("Kaizena Flow"), placeholder: m.placeholder },
      chatOn: profile !== null,
    };
  }
  const market = store.markets.find((candidate) => candidate.slug === widget?.market) ?? store.markets[0];
  const lang = market?.lang ?? "en";
  const m = t(lang).chat;
  const words = profile && market ? chatLabels(lang, market.locale, profile, store.name) : null;
  const light = store.theme.settings.light;
  return {
    themeCss: themeCss(store.theme.settings, ".kz-widget-preview", "light"),
    colours: { accent: light.accent, background: light.background, text: light.text },
    labels: { deskName: store.name, open: words?.open ?? m.open, greeting: words?.greeting ?? m.peopleGreeting(store.name), placeholder: m.placeholder },
    chatOn: profile !== null,
  };
}
