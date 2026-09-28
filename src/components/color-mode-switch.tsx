"use client";

import { useSyncExternalStore } from "react";

import { applyColorChoice, COLOR_EVENT, showsDark, type ColorChoice } from "@/lib/color-mode";

import { Icon } from "./icons";

function subscribe(changed: () => void): () => void {
  const device = window.matchMedia("(prefers-color-scheme: dark)");
  device.addEventListener("change", changed);
  window.addEventListener(COLOR_EVENT, changed);
  return () => {
    device.removeEventListener("change", changed);
    window.removeEventListener(COLOR_EVENT, changed);
  };
}

/** Whether the page shows its dark colours, kept current as they change (D99). */
export function useShowsDark(fallback: "light" | "dark" | null = null): boolean {
  return useSyncExternalStore(subscribe, showsDark, () => fallback === "dark");
}

/**
 * A button that switches the page between light and dark (D99), shown as the
 * colours it switches to. The choice is kept in the browser under `storageKey`;
 * choosing what the page shows by itself (`fallback`, a store's fixed mode,
 * else the device's) forgets it again. `onChoice` hears it, to save it
 * elsewhere too (the admin keeps an account's choice).
 */
export function ColorModeSwitch({
  storageKey,
  fallback = null,
  labels,
  className = "flex size-11 items-center justify-center rounded-full hover:bg-current/5",
  onChoice,
}: {
  storageKey: string;
  fallback?: "light" | "dark" | null;
  labels: { toDark: string; toLight: string };
  className?: string;
  onChoice?: (choice: ColorChoice) => void;
}) {
  const dark = useShowsDark(fallback);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    const own = fallback ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const choice: ColorChoice = next === own ? "system" : next;
    applyColorChoice(storageKey, choice, fallback);
    onChoice?.(choice);
  };
  const label = dark ? labels.toLight : labels.toDark;
  return (
    <button type="button" onClick={toggle} title={label} className={className}>
      <Icon name={dark ? "sun" : "moon"} />
      <span className="sr-only">{label}</span>
    </button>
  );
}
