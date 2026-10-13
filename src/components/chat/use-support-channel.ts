"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PING_DEBOUNCE_MS, isTopic, maySendTyping, readTyping, type Typist } from "@/lib/support-realtime";

type Channel = { send: (message: { type: "broadcast"; event: string; payload: Record<string, unknown> }) => Promise<unknown> };

/**
 * Support's realtime (D216, `docs/support.md` 4.6, step 12): joins the given topics (a conversation's `sc:` and the desks' `sd:`,
 * keys handed out only after the check that guards their data) and calls `onPing` when the database says something changed there
 * (debounced, `{at}` only: the caller then asks the site as it would on its timer), and `onTyping` when the other side is typing on a
 * conversation's topic. The library is loaded only when there is a topic to join and the site has Supabase's public settings; it
 * reports `connected` while subscribed, and any failure leaves the caller polling at its normal rate, saying nothing.
 */
export function useSupportChannel(topics: readonly string[], handlers: { onPing: () => void; onTyping?: (by: Typist) => void }) {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  const channels = useRef(new Map<string, Channel>());
  const lastTyping = useRef(0);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const wanted = topics.filter(isTopic).sort().join(",");
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!wanted || !url || !key) return;
    const open = channels.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let client: { removeAllChannels: () => Promise<unknown>; disconnect: () => Promise<unknown> } | null = null;
    const joined = new Set<string>();
    const ping = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => handlersRef.current.onPing(), PING_DEBOUNCE_MS);
    };
    void (async () => {
      try {
        const { RealtimeClient } = await import("@supabase/realtime-js");
        if (stopped) return;
        const realtime = new RealtimeClient(`${url}/realtime/v1`, { params: { apikey: key } });
        client = realtime;
        for (const topic of wanted.split(",")) {
          const channel = realtime.channel(topic, { config: { broadcast: { self: false } } });
          channel.on("broadcast", { event: "m" }, ping);
          channel.on("broadcast", { event: "s" }, ping);
          channel.on("broadcast", { event: "t" }, (message: { payload?: unknown }) => {
            const by = readTyping(message.payload);
            if (by) handlersRef.current.onTyping?.(by);
          });
          channel.subscribe((status: string) => {
            if (stopped) return;
            if (status === "SUBSCRIBED") joined.add(topic);
            else joined.delete(topic);
            setConnected(joined.size > 0);
          });
          open.set(topic, channel as unknown as Channel);
        }
      } catch {
        // No realtime here: polling goes on as it is.
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      open.clear();
      setConnected(false);
      if (client) void client.removeAllChannels().then(() => client?.disconnect()).catch(() => undefined);
    };
  }, [wanted]);

  /** Tells the conversation's other side that this side is typing, at most every 2 seconds; never the words. */
  const sendTyping = useCallback((topic: string | null, by: Typist) => {
    const channel = topic ? channels.current.get(topic) : undefined;
    const now = Date.now();
    if (!channel || !maySendTyping(lastTyping.current, now)) return;
    lastTyping.current = now;
    void channel.send({ type: "broadcast", event: "t", payload: { by } }).catch(() => undefined);
  }, []);

  return { connected, sendTyping };
}
