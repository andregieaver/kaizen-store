import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";

import { CustomCss } from "@/components/custom-css";
import { FontLinks } from "@/components/font-links";
import { FrameChat } from "@/components/site-chat";
import { fontStack, siteFontFamilies } from "@/lib/fonts";
import { widgetCss } from "@/lib/support-widget-style";
import { themeCss } from "@/lib/theme";
import { findFont, siteFontStyle } from "@/server/fonts";
import { frameWidget, recheckFromFrame, widgetShop } from "@/server/support-widgets";

export const metadata: Metadata = { title: "Chat", robots: { index: false, follow: false } };

/** The path of the page holding the frame, as the loader sends it; the front page for anything else. */
const pathOf = (raw: string | string[] | undefined): string => (typeof raw === "string" && /^\/[^\s]{0,299}$/.test(raw) ? raw : "/");

/** A short name for a stylesheet's text, so a changed look is a new stylesheet to React. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The element around the chat that carries the widget's look. */
const SCOPE = ".kz-chat-widget";

/**
 * A chat widget on a site of the owner's own (D582): a frame the tag's loader (`public/embed/chat.js`) puts on each page of the widget's
 * sites, at `/embed/chat/{key}/{host}?p={path}`. Only the page's host may frame it (`embedFrameHeaders()` in `next.config.ts`), and it draws
 * the chat only when that host is one of the widget's sites and the tag was found there; a site not yet found is checked again here (at
 * most every ten minutes), so the chat appears on the next page once the tag is in place. Anything else draws nothing, and the loader keeps
 * the frame see-through. The chat wears the store's theme, then the widget's own look over it, then the owner's own CSS for the widget.
 */
async function Frame({ params, searchParams }: PageProps<"/embed/chat/[key]/[host]">) {
  const { key, host: raw } = await params;
  // The host as the loader wrote it (a malformed escape is no host, and draws nothing).
  const host = (() => {
    try {
      return decodeURIComponent(raw).toLowerCase();
    } catch {
      return "";
    }
  })();
  const widget = await frameWidget(key, host);
  if (!widget) return null;
  if (!widget.verified) {
    after(() => recheckFromFrame(widget));
    return null;
  }
  const shop = await widgetShop(widget);
  if (widget.storeId && !shop) return null;
  const path = pathOf((await searchParams).p);
  const store = shop?.store ?? null;
  const font = widget.style.font ? findFont(widget.style.font) : null;
  const own = widgetCss(widget.style, SCOPE, font ? fontStack(font.family, font.category) : null);
  return (
    <>
      {store && (
        <>
          <FontLinks families={siteFontFamilies(store.fonts)} />
          {/* The store's colours (D60) on the frame's root: the widget reads the same variables as on the store's own pages. */}
          <style href={`embed-theme-${store.id}`} precedence="theme">
            {themeCss(store.theme.settings, "html:root")}
          </style>
        </>
      )}
      {font && <FontLinks families={[font.family]} />}
      <style href={`embed-widget-${widget.id}-${hash(own)}`} precedence="custom">
        {own}
      </style>
      <CustomCss css={widget.style.css} name={`widget-${widget.id}`} />
      <div className="kz-chat-widget font-sans" style={store && !font ? siteFontStyle(store.fonts) : undefined}>
        <FrameChat widget={widget} shop={shop} widgetKey={key} host={host} path={path} />
      </div>
    </>
  );
}

export default function EmbedChatPage(props: PageProps<"/embed/chat/[key]/[host]">) {
  return (
    <Suspense>
      <Frame {...props} />
    </Suspense>
  );
}
