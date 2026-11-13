"use client";

import { FontLinks } from "@/components/font-links";
import { Icon } from "@/components/icons";
import { scopedCss } from "@/lib/custom-css";
import { PANEL_WIDTH, widgetCss, type WidgetStyle } from "@/lib/support-widget-style";

/** The preview's own box: the widget's look is drawn on it, as the frame draws it on the chat's. */
const SCOPE = ".kz-widget-preview";

/**
 * A chat widget as a visitor will see it (D581), drawn in the admin from the same CSS the frame uses (`widgetCss()` over the store's theme,
 * then the owner's own CSS, kept inside the box): the open chat on the widget's side, its greeting and a visitor's message, and the closed
 * button where it will sit. A picture of the chat, not the chat: nothing here can be sent.
 */
export function WidgetPreview({
  style,
  themeCss,
  labels,
  caption,
}: {
  style: WidgetStyle;
  /** The store's theme on `.kz-widget-preview` in its light colours (`themeCss(…, ".kz-widget-preview", "light")`), or none for Kaizena Flow's. */
  themeCss: string;
  labels: { deskName: string; open: string; greeting: string; visitor: string; placeholder: string };
  caption: string;
}) {
  const fontFamily = style.font ? `"${style.font}", system-ui, sans-serif` : null;
  const css = [themeCss, widgetCss(style, SCOPE, fontFamily), scopedCss(style.css, SCOPE)].filter(Boolean).join("\n");
  const width = Math.round(PANEL_WIDTH[style.width] * 0.72);
  const side = style.side;
  const open = style.label || labels.open;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-eyebrow text-muted">{caption}</figcaption>
      {style.font && <FontLinks families={[style.font]} />}
      <style>{css}</style>
      {/* `data-theme-preview`: the admin's own colours leave a drawing of a store's look alone (admin.css). */}
      <div
        aria-hidden
        data-theme-preview=""
        className="kz-widget-preview relative h-[26rem] overflow-hidden rounded-panel border border-line bg-[repeating-linear-gradient(45deg,#f5f5f4_0_12px,#efeeec_12px_24px)] font-sans"
      >
        <section
          data-chat-panel=""
          className="absolute top-3 flex h-[17rem] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-xl"
          style={{ [side]: 12, width }}
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span data-chat-avatar="" className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Icon name="chat" className="size-1/2" />
            </span>
            <span className="truncate text-sm font-medium">{labels.deskName}</span>
          </header>
          <div className="flex flex-1 flex-col gap-2 p-3 text-[13px]">
            <p className="max-w-[85%] rounded-lg rounded-bl-none bg-surface px-3 py-2">{style.greeting || labels.greeting}</p>
            <p className="ml-auto max-w-[85%] rounded-lg rounded-br-none bg-foreground px-3 py-2 text-background">{labels.visitor}</p>
          </div>
          <div className="flex items-center gap-2 border-t border-border p-2">
            <span className="flex-1 truncate rounded-md border border-border px-2 py-1.5 text-xs text-muted">{labels.placeholder}</span>
            <span className="button-primary rounded-button p-1.5">
              <Icon name="send" className="size-4" />
            </span>
          </div>
        </section>
        <span
          data-chat-launcher=""
          className={`absolute flex items-center gap-2 rounded-full bg-foreground p-1 text-background shadow-lg ${style.launcher === "label" ? "pr-4" : ""}`}
          style={{ [side]: Math.min(style.offsetX, 120), bottom: Math.min(style.offsetY, 120) }}
        >
          <span data-chat-avatar="" className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Icon name="chat" className="size-1/2" />
          </span>
          {style.launcher === "label" && <span className="text-sm font-medium whitespace-nowrap">{open}</span>}
        </span>
      </div>
    </figure>
  );
}
