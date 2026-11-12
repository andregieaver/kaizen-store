"use client";

import { useId, useLayoutEffect, type ReactNode } from "react";
import { useAdminText } from "@/components/admin/admin-text";
import { MoveButton, ResizeHandles, dialogStyle, focusPastMoveButton, useMovable } from "./movable";

/**
 * A modal dialog on the browser's own `<dialog>`: focus stays inside,
 * Escape and the close button close it, and focus returns to where it was.
 *
 * Like the builder's settings panel, it moves by its title bar (or its move button and the arrow keys) and resizes from
 * any edge or corner (`useMovable`). It opens centred; one given `remember` opens where it was last left, at that size.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  remember,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** A name to keep its place and size under in the browser, for a dialog worth making larger once (the media library). */
  remember?: string;
}) {
  const ui = useAdminText("common").ui;
  const movable = useMovable<HTMLDialogElement>({ remember });
  const { ref, rect, reset } = movable;
  const titleId = useId();
  // Placed before it is drawn, so a remembered place shows without a jump.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      reset();
      dialog.showModal();
      focusPastMoveButton(dialog);
    }
    if (!open && dialog.open) dialog.close();
  }, [open, ref, reset]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop (the dialog itself, outside its box) closes it; not the end of a drag.
        if (event.target === event.currentTarget && !movable.justMoved()) onClose();
      }}
      style={dialogStyle(rect)}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-visible rounded-panel border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/40 ${
        wide ? "max-w-3xl" : "max-w-lg"
      }`}
    >
      {open && (
        // The dialog's own border takes 2 px of its height; only the middle scrolls.
        <div className={`flex flex-col ${rect?.h != null ? "h-full" : "max-h-[calc(90dvh-2px)]"}`}>
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
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
      {open && <ResizeHandles movable={movable} />}
    </dialog>
  );
}
