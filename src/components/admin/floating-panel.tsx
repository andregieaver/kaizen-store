"use client";

import { useEffect, useId, type ReactNode } from "react";
import { useAdminText } from "@/components/admin/admin-text";
import { MoveButton, ResizeHandles, clampRect, defaultRect, readStoredRect, useMovable, viewport, type PanelRect } from "./movable";

/**
 * The settings panel of a row, column or component in the page builder: a floating, non-modal panel the editor can move
 * by its title bar and resize from any edge or corner, while the page behind it stays in use (clicking another part
 * opens that part's settings in it). Its place and size are remembered in the browser, kept inside the window, and
 * given back to the default one when the window cannot hold them. Moving and resizing are `useMovable`'s, shared with
 * every `Modal`.
 *
 * Same props as `Modal`; Escape or Close closes it, and focus returns to where it was.
 */

export { PANEL_MIN, clampRect, defaultRect, resizeRect, type PanelEdge, type PanelRect } from "./movable";

export function FloatingPanel(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Made when it opens, so its place is worked out from the window as it is then, never on the server.
  return props.open ? <PlacedPanel {...props} /> : null;
}

function PlacedPanel({
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ui = useAdminText("common").ui;
  const titleId = useId();
  // Where it was last left (kept inside this window), else its default place.
  const movable = useMovable<HTMLDivElement>({
    remember: "settings-panel",
    initial: () => {
      const view = viewport();
      return clampRect(readStoredRect("settings-panel") ?? defaultRect(view, wide), view);
    },
  });
  const { ref } = movable;
  const rect = movable.rect as PanelRect;

  // Focus is in the panel while it is open and goes back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // As a dialog did: the first field to write in, else the panel itself.
    const first = ref.current?.querySelector<HTMLElement>('[data-panel-body] :is(input:not([type="hidden"], [type="color"], [type="checkbox"], [type="radio"]), textarea, select, [contenteditable="true"])');
    (first ?? ref.current)?.focus({ preventScroll: true });
    return () => before?.focus({ preventScroll: true });
  }, [ref]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-settings-panel=""
      onKeyDown={(event) => {
        // A dialog opened from inside the panel (a picker) takes its own Escape.
        if (event.key === "Escape" && !event.defaultPrevented && !(event.target as HTMLElement).closest("dialog")) onClose();
      }}
      style={{ left: rect.x, top: rect.y, width: rect.w, ...(rect.h !== null && { height: rect.h }), maxHeight: rect.h === null ? "90dvh" : undefined }}
      className="fixed z-50 flex max-w-[100vw] flex-col rounded-panel border border-line bg-card text-ink shadow-2xl outline-none"
    >
      <div
        {...movable.bar}
        className="flex cursor-move touch-none items-center justify-between gap-4 rounded-t-lg border-b border-line px-5 py-3 select-none"
      >
        <h2 id={titleId} className="text-title text-ink">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <MoveButton movable={movable} />
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label={ui.close}
            className="flex size-9 items-center justify-center rounded-full hover:bg-sunken"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div data-panel-body="" className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      <ResizeHandles movable={movable} />
    </div>
  );
}
