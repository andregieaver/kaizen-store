"use client";

import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { cssValue, FRAME_SANDBOX, frameDocument, frameHeight, HEIGHT_MESSAGE, LOOK_MESSAGE, type FrameLook } from "@/lib/html-frame";

import { usePageLanguage } from "./page-language";

/**
 * The owner's HTML (D91) in a sandboxed frame of its own origin, which
 * grows to its content's height unless a height is set, and takes the
 * page's font and colour. Set to wait, it shows a button first and loads
 * nothing until pressed, for content from other services.
 */
export function HtmlFrame({ html, title, height, waitForClick }: { html: string; title: string; height: number | undefined; waitForClick: boolean }) {
  const [shown, setShown] = useState(!waitForClick);
  const m = t(usePageLanguage());
  if (!shown) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-6 text-center">
        <p className="text-sm text-muted">{m.htmlFromElsewhere}</p>
        <button type="button" onClick={() => setShown(true)} className="button-primary rounded-button px-4 py-2 text-sm font-medium">
          {m.showContent}
        </button>
      </div>
    );
  }
  return <Frame html={html} title={title} height={height} />;
}

function Frame({ html, title, height }: { html: string; title: string; height: number | undefined }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [fitted, setFitted] = useState<number | null>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const sendLook = () => {
      const style = getComputedStyle(frame.parentElement ?? frame);
      const look: FrameLook = {
        fontFamily: cssValue(style.fontFamily),
        fontSize: cssValue(style.fontSize),
        lineHeight: cssValue(style.lineHeight),
        color: cssValue(style.color),
      };
      frame.contentWindow?.postMessage({ type: LOOK_MESSAGE, look }, "*");
    };
    const onMessage = (event: MessageEvent) => {
      // Only this frame's own messages: the others' on the page are theirs.
      if (event.source !== frame.contentWindow || event.data?.type !== HEIGHT_MESSAGE) return;
      const next = frameHeight(event.data.height);
      if (next !== null) setFitted(next);
    };
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", sendLook);
    sendLook();
    return () => {
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", sendLook);
    };
  }, []);
  return (
    <iframe
      ref={ref}
      srcDoc={frameDocument(html)}
      sandbox={FRAME_SANDBOX}
      title={title || undefined}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      className="block w-full border-0"
      // `normal` like the frame's own document, so the frame stays see-through on a dark theme.
      style={{ height: height ?? fitted ?? 150, colorScheme: "normal" }}
    />
  );
}
