"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";

import { ColorModeSwitch } from "@/components/color-mode-switch";
import { ADMIN_COLOR_KEY, applyColorChoice, COLOR_CHOICES, COLOR_EVENT, isColorChoice, type ColorChoice } from "@/lib/color-mode";

/**
 * The admin's light or dark (D99): each account's own choice, kept on the
 * account so it follows them to any device, and in the browser so that
 * pages open in it (the admin's first script, `colorModeScript`).
 */

export type SaveColorMode = (choice: ColorChoice) => Promise<void>;

function stored(): ColorChoice {
  try {
    const value = localStorage.getItem(ADMIN_COLOR_KEY);
    return isColorChoice(value) ? value : "system";
  } catch {
    return "system";
  }
}

function subscribe(changed: () => void): () => void {
  window.addEventListener(COLOR_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(COLOR_EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}

/** Brings this browser in line with the account's choice, when it was made on another device. */
export function AdminColorSync({ saved }: { saved: ColorChoice }) {
  useEffect(() => {
    if (stored() !== saved) applyColorChoice(ADMIN_COLOR_KEY, saved);
  }, [saved]);
  return null;
}

/** The header's switch to the other colours, kept on the account. */
export function AdminColorSwitch({ save, className }: { save: SaveColorMode; className?: string }) {
  const [, start] = useTransition();
  return (
    <ColorModeSwitch
      storageKey={ADMIN_COLOR_KEY}
      labels={{ toDark: "Switch to dark colours", toLight: "Switch to light colours" }}
      className={className ?? "flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground"}
      onChoice={(choice) => start(() => save(choice))}
    />
  );
}

/** Your account's choice of the admin's colours: the device's, light or dark. */
export function AppearanceField({ saved, save }: { saved: ColorChoice; save: SaveColorMode }) {
  const choice = useSyncExternalStore(subscribe, stored, () => saved);
  const [pending, start] = useTransition();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Colours</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(COLOR_CHOICES) as ColorChoice[]).map((option) => (
          <label
            key={option}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-checked:border-foreground has-checked:font-medium"
          >
            <input
              type="radio"
              name="color-mode"
              value={option}
              checked={choice === option}
              onChange={() => {
                applyColorChoice(ADMIN_COLOR_KEY, option);
                start(() => save(option));
              }}
            />
            {COLOR_CHOICES[option]}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {pending ? "Saving …" : "Kept with your account, so the admin looks the same on every device you sign in on."}
      </p>
    </fieldset>
  );
}
