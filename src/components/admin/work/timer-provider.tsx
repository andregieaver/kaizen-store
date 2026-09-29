"use client";

import type { ReactNode } from "react";

import type { RunningTimer } from "@/server/work-time";

import { TimerContext } from "./timer-context";
import { TimerAlertDialog, TimerBar } from "./timer-bar";
import { useWorkTimer } from "./use-work-timer";

/**
 * Holds the person's timer for every Work page under it (`WorkShell`): the
 * bar at the top, the estimate warnings, and what the start and stop buttons
 * and the live figures below read (`useWorkTimerApi`).
 */
export function WorkTimerProvider({
  storeSlug,
  accountId,
  serverTimer,
  children,
}: {
  storeSlug: string;
  accountId: string;
  serverTimer: RunningTimer | null;
  children: ReactNode;
}) {
  const api = useWorkTimer({ storeSlug, accountId, serverTimer });
  return (
    <TimerContext.Provider value={api}>
      <TimerBar />
      {children}
      <TimerAlertDialog />
    </TimerContext.Provider>
  );
}
