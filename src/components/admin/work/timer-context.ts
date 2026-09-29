"use client";

import { createContext, useContext } from "react";

import type { WorkTimer } from "./use-work-timer";

export const TimerContext = createContext<WorkTimer | null>(null);

/**
 * The person's timer as this browser shows it, for everything under a
 * `WorkTimerProvider`: the bar at the top of the page, the start and stop
 * buttons of assignments and tasks, the live figures of an estimate. Null
 * outside one (a form drawn on its own then has no timer to show).
 */
export const useWorkTimerApi = (): WorkTimer | null => useContext(TimerContext);
