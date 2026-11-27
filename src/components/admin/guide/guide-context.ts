"use client";

import { createContext, useContext } from "react";

import type { GuideMessages } from "@/lib/admin-messages/guide.en";
import type { GuideAsk, GuideEvent, GuideMoment, GuidePlace, GuideProgress, GuideSettings } from "@/lib/guide";

/**
 * What Guide's runtime (`guide-runtime.tsx`) hands what it draws (`guide-layer.tsx`), D909: the record, the level's places and words, the
 * moment drawn and the ways to answer it. Both load after the screen is drawn; nothing here is in a screen's first scripts.
 */
export type GuideToast = "done" | "later" | null;

export type GuideState = {
  /** When the record was read (ms): the panel's day and the level in force are read against it. */
  now: number;
  progress: GuideProgress;
  settings: GuideSettings;
  places: GuidePlace[];
  home: string;
  /** Which level's words the welcome's rail takes: a store's, the platform's or the owner's control center's. */
  variant: "store" | "platform" | "owner";
  words: GuideMessages;
  moment: GuideMoment;
  panel: boolean;
  toast: GuideToast;
  dispatch: (event: GuideEvent) => void;
  saveSettings: (settings: GuideSettings) => void;
  setPanel: (open: boolean) => void;
  /** Ask for a place (or the whole welcome) to be shown on arrival; the panel moves there. */
  ask: (ask: GuideAsk) => void;
  /** The moment drawn is over: `done`, put away (`later`), or it found nothing to point at (`none`). */
  finish: (how: "done" | "later" | "none") => void;
  setToast: (toast: GuideToast) => void;
};

export const GuideContext = createContext<GuideState | null>(null);

export function useGuide(): GuideState | null {
  return useContext(GuideContext);
}
