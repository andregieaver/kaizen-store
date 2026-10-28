"use client";

import { useSyncExternalStore } from "react";

import { ASK_AI_MANAGER_EVENT, type AskDetail } from "@/lib/alert-ask";

/**
 * *Ask the AI manager* beside an alert (D348): drawn only where the AI manager's launcher is on the page, it opens the panel with the alert's own words
 * and figures as the first message (written by code, `askAboutAlert()`).
 */
/** Follows the launcher's mark on `<html>`, which it sets after it mounts. */
function watchMark(changed: () => void): () => void {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ai-manager"] });
  return () => observer.disconnect();
}

export function AskAboutAlert({ message, label, srLabel }: { message: string; label: string; srLabel: string }) {
  const here = useSyncExternalStore(watchMark, () => document.documentElement.dataset.aiManager === "on", () => false);
  if (!here) return null;
  return (
    <button
      type="button"
      data-ask-alert
      onClick={() => window.dispatchEvent(new CustomEvent<AskDetail>(ASK_AI_MANAGER_EVENT, { detail: { message } }))}
      className="font-medium text-(--brand-text) underline-offset-2 hover:underline"
    >
      {label}
      <span className="sr-only">{srLabel}</span>
    </button>
  );
}
