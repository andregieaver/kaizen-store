import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";

import { FontLinks } from "@/components/font-links";
import { FrameChat } from "@/components/site-chat";
import { siteFontFamilies } from "@/lib/fonts";
import { themeCss } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
import { embedForFrame, embedShop, recheckFromFrame } from "@/server/support-embeds";

export const metadata: Metadata = { title: "Chat", robots: { index: false, follow: false } };

/** The path of the page holding the frame, as the loader sends it; the front page for anything else. */
const pathOf = (raw: string | string[] | undefined): string => (typeof raw === "string" && /^\/[^\s]{0,299}$/.test(raw) ? raw : "/");

/**
 * The chat on a site of the owner's own (D581): a frame the tag's loader (`public/embed/chat.js`) puts on each page of the site, at
 * `/embed/chat/{key}/{host}?p={path}`. Only the page's host may frame it (`embedFrameHeaders()` in `next.config.ts`), and it draws the chat
 * only when that host is the site's and its tag was found; a site not yet found is checked again here (at most every ten minutes), so the
 * chat appears on the next page once the tag is in place. Anything else draws nothing, and the loader keeps the frame hidden.
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
  const embed = await embedForFrame(key, host);
  if (!embed) return null;
  if (!embed.verified) {
    after(() => recheckFromFrame(embed));
    return null;
  }
  const shop = await embedShop(embed);
  if (embed.storeId && !shop) return null;
  const path = pathOf((await searchParams).p);
  const store = shop?.store ?? null;
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
      <div className="font-sans" style={store ? siteFontStyle(store.fonts) : undefined}>
        <FrameChat embed={embed} shop={shop} siteKey={key} host={host} path={path} />
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
