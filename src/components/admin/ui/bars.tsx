import type { ReactNode } from "react";

import type { Signal } from "@/lib/admin-schemes";

import { dotClass } from "./chip";

/**
 * Bars (docs/admin-style.md 5.8). A share bar ("Paid on time 58 %") is read from its label and figure; the bar repeats them and is
 * hidden from screen readers. A score bar ("Payment history +22") is a label, a short bar and the points, one signal for a whole
 * list. A share outside 0..1 is drawn at the nearest end, never past the track.
 */

const clamp = (share: number) => (Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0);

/** The fill's width, as CSS. */
export const fillWidth = (share: number) => `${Math.round(clamp(share) * 1000) / 10}%`;

function Track({ share, signal, className }: { share: number; signal: Signal; className: string }) {
  return (
    <span aria-hidden className={`block h-2 overflow-hidden rounded-pill bg-sunken forced-colors:border ${className}`}>
      <span className={`block h-full rounded-pill ${dotClass(signal)} forced-colors:bg-[CanvasText]`} style={{ width: fillWidth(share) }} />
    </span>
  );
}

export function ShareBar({ label, figure, share, signal }: { label: ReactNode; figure: ReactNode; share: number; signal: Signal }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 items-center gap-2 text-body text-ink-2">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotClass(signal)}`} />
          {label}
        </span>
        <span className="text-body-strong text-ink tabular-nums">{figure}</span>
      </div>
      <Track share={share} signal={signal} className="w-full" />
    </div>
  );
}

export function ScoreBar({ label, points, share, signal }: { label: ReactNode; points: ReactNode; share: number; signal: Signal }) {
  return (
    <div className="flex items-center gap-4">
      <span className="min-w-0 flex-1 text-body text-ink-2">{label}</span>
      <Track share={share} signal={signal} className="w-28 shrink-0" />
      <span className="w-12 shrink-0 text-right text-body text-muted tabular-nums">{points}</span>
    </div>
  );
}
