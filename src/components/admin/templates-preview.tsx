"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { KIND_LABELS, type TemplateItem } from "@/lib/templates";

import { PREVIEW_DEVICES, PREVIEW_TIMEOUT_MS, deviceWidth, type PreviewDevice } from "./templates-helpers";
import { KaizenBadge, PageTypeBadge, Problems } from "./templates-parts";

/**
 * A template shown before it is switched on or used (D127): a native `<dialog>` with the template's own page, drawn
 * as the store's pages are, in a frame that can be a desktop's, a tablet's or a phone's width, and the same actions as
 * its card. It stacks above the Browse modal it may be opened from and gives the focus back to the button that opened
 * it. The page in the frame is chrome free and nothing in it is copied or saved.
 */
export function TemplatePreviewDialog({
  item,
  href,
  returnFocus,
  reason,
  switching,
  using,
  usingAny,
  problems,
  onToggleActive,
  onUse,
  onClose,
}: {
  /** The template to preview; null while the dialog is closed. */
  item: TemplateItem | null;
  /** Where its preview page is, from `templates.previewHref`. */
  href: string | null;
  /** The button that opened the dialog, which gets the focus back. */
  returnFocus: HTMLElement | null;
  /** Why Use is off, or null. */
  reason: string | null;
  /** Its activation is being changed. */
  switching: boolean;
  /** This template is being fetched to use, and any is. */
  using: boolean;
  usingAny: boolean;
  problems: readonly string[];
  onToggleActive: () => void;
  onUse: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const open = item !== null;
  const opener = useRef(returnFocus);
  useEffect(() => {
    opener.current = returnFocus;
  }, [returnFocus]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      dialog.close();
      // The browser returns the focus too, but the button may be in a list that was drawn again since.
      const button = opener.current;
      if (button?.isConnected) button.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-5xl rounded-lg border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50"
    >
      {item && (
        <div className="flex max-h-[calc(94dvh-2px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={titleId} className="truncate font-medium">
                Preview: {item.name}
              </h2>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>{KIND_LABELS[item.kind].one}</span>
                <PageTypeBadge item={item} />
                <span aria-hidden>·</span>
                <span>By {item.publisher}</span>
                {item.fromKaizen && <KaizenBadge />}
              </p>
              {item.summary && <p className="text-xs text-muted">{item.summary}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-surface"
            >
              <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <DeviceSwitch device={device} onDevice={setDevice} />
            {/* A new frame for each template, so it starts loading again. */}
            {href && <PreviewFrame key={item.id} title={`Preview of ${item.name}`} href={href} device={device} />}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            <div className="mr-auto flex min-w-0 flex-col gap-1">
              <Problems problems={problems} />
              {reason && (
                <p id={reasonId} className="text-xs text-muted">
                  {reason}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-border px-4 text-sm">
              Close
            </button>
            <button
              type="button"
              onClick={onToggleActive}
              disabled={switching}
              aria-pressed={item.active}
              className="min-h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-surface disabled:opacity-50"
            >
              {item.active ? "Deactivate for this store" : "Activate for this store"}
            </button>
            <button
              type="button"
              onClick={onUse}
              disabled={usingAny || reason !== null}
              aria-describedby={reason ? reasonId : undefined}
              title={reason ?? undefined}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              {using ? "Adding …" : "Use"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** Desktop, tablet or phone: radio-style buttons, one tab stop, the arrow keys move between them. */
function DeviceSwitch({ device, onDevice }: { device: PreviewDevice; onDevice: (device: PreviewDevice) => void }) {
  const id = useId();
  const select = (index: number) => {
    const next = PREVIEW_DEVICES[(index + PREVIEW_DEVICES.length) % PREVIEW_DEVICES.length];
    onDevice(next.key);
    document.getElementById(`${id}-${next.key}`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const move: Record<string, number | undefined> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: PREVIEW_DEVICES.length - 1,
    };
    const to = move[event.key];
    if (to === undefined) return;
    event.preventDefault();
    select(to);
  };
  return (
    <div role="radiogroup" aria-label="Preview width" className="flex w-fit gap-1 rounded-md bg-surface p-1">
      {PREVIEW_DEVICES.map((each, index) => (
        <button
          key={each.key}
          id={`${id}-${each.key}`}
          type="button"
          role="radio"
          aria-checked={device === each.key}
          tabIndex={device === each.key ? 0 : -1}
          onClick={() => onDevice(each.key)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className="min-h-9 rounded px-3 text-xs font-medium text-muted aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm"
        >
          {each.label}
          {each.width && <span className="sr-only">, {each.width} pixels wide</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The frame with the template's page: loading, loaded, or failed (an error event, or no answer in time), with a way to
 * try again. Sandboxed without scripts: it is a picture of the page, and it can run nothing.
 */
function PreviewFrame({ title, href, device }: { title: string; href: string; device: PreviewDevice }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setStatus((now) => (now === "loading" ? "failed" : now)), PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, attempt]);

  return (
    <div className="relative flex h-[min(60dvh,44rem)] min-h-64 justify-center overflow-auto rounded-md border border-border bg-surface">
      {status !== "failed" && (
        <iframe
          key={attempt}
          title={title}
          src={href}
          sandbox="allow-same-origin"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("failed")}
          style={{ width: deviceWidth(device) }}
          className={`h-full max-w-full border-0 bg-white ${status === "loading" ? "opacity-0" : ""}`}
        />
      )}
      {status === "loading" && (
        <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          Loading the preview …
        </p>
      )}
      {status === "failed" && (
        <div role="alert" className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm">
          <p>The preview could not be loaded.</p>
          <button
            type="button"
            onClick={() => {
              setAttempt((n) => n + 1);
              setStatus("loading");
            }}
            className="min-h-9 rounded-md border border-border bg-background px-3 text-xs"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
