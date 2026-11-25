"use client";

import { useEffect } from "react";

import { CANVA_CHANNEL } from "@/lib/canva-paths";

/**
 * The back page's one job (D898 C2): tell the field's tab, on this site's channel, that the edit is back from Canva (`edit`) or how a
 * connect ended (`connected`), then close this tab, which a tab the field opened may do. Any other tab stays, its words saying it may go.
 */
export function CanvaBackSignal({ edit, connected }: { edit: string | null; connected: boolean | null }) {
  useEffect(() => {
    if (!edit && connected === null) return;
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel(CANVA_CHANNEL);
      channel.postMessage(edit ? { edit } : { connected });
      channel.close();
    }
    const timer = window.setTimeout(() => window.close(), 400);
    return () => window.clearTimeout(timer);
  }, [edit, connected]);
  return null;
}
