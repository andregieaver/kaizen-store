"use client";

import { useEffect, useRef } from "react";

import { ASK_AI_MANAGER_EVENT, type AskDetail } from "@/lib/alert-ask";

/**
 * The briefing's *Ask the AI manager* (D416): a link from the email opens the store's home page with `?ask={alert}`, and this opens the AI
 * manager with that alert's words and figures in its message box, once, as the button beside the alert does. Nothing is sent: the person
 * reads it and presses Send. The address loses `?ask` so a reload does not ask again.
 */
export function AskOnArrival({ message }: { message: string }) {
  const done = useRef(false);
  useEffect(() => {
    const ask = () => {
      if (done.current || document.documentElement.dataset.aiManager !== "on") return false;
      done.current = true;
      window.dispatchEvent(new CustomEvent<AskDetail>(ASK_AI_MANAGER_EVENT, { detail: { message } }));
      const url = new URL(window.location.href);
      url.searchParams.delete("ask");
      window.history.replaceState(window.history.state, "", url);
      return true;
    };
    if (ask()) return;
    // The launcher marks the page once it is ready to listen.
    const observer = new MutationObserver(() => {
      if (ask()) observer.disconnect();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ai-manager"] });
    return () => observer.disconnect();
  }, [message]);
  return null;
}
