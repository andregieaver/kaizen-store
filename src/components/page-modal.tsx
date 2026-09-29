"use client";

import { useEffect, useId, useMemo, useRef, type CSSProperties, type ReactNode } from "react";

import {
  AUTO_MIN_MS,
  MODAL_OVERLAYS,
  MODAL_SIZES,
  NO_SCROLL,
  autoAllowed,
  isExitIntent,
  keyFromHash,
  keyFromLink,
  mayRemember,
  modalDomId,
  modalHash,
  rememberClose,
  shouldAutoOpen,
  stepScrollIntent,
  type ModalMemory,
  type RowModal,
  type ScrollIntentState,
} from "@/lib/page-modal";

/**
 * A modal in a page (D121): a row in a native `<dialog>`, closed until a
 * link to `#modal-{key}`, an element with its class, a timer or exit intent
 * opens it. Focus is trapped and moves in, Escape closes, and the page
 * behind stops scrolling while it is open (`globals.css`, which lifts by
 * itself when the dialog goes). The content is server-rendered inside the
 * closed dialog, so nothing shows or shifts. No script from anyone else.
 */

type How = "auto" | "link" | "class" | "hash";
type Entry = {
  key: string;
  linkable: boolean;
  className: string | undefined;
  open: (how: How, from?: Element | null) => boolean;
  close: () => void;
};

// What is on the page now: its modals, the one that is open, and those closed since the page was loaded.
const registry = new Map<string, Entry>();
let openKey: string | null = null;
const closedThisLoad = new Set<string>();

const storage = (kind: "sessionStorage" | "localStorage") => {
  try {
    return window[kind];
  } catch {
    return null;
  }
};
const browserMemory = (): ModalMemory => ({ session: storage("sessionStorage"), local: storage("localStorage") });

/** A press on a link to `#modal-{key}` or on an element with a modal's class opens it, at any place on the page. */
function onDocumentClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a[href]");
  if (link) {
    const key = keyFromLink(link.getAttribute("href"), location);
    const entry = key ? registry.get(key) : undefined;
    if (entry?.linkable) {
      // The page must not jump to the anchor, nor a router take it.
      event.preventDefault();
      entry.open("link", link);
      return;
    }
  }
  for (const entry of registry.values()) {
    if (!entry.className) continue;
    const from = event.target.closest(`.${CSS.escape(entry.className)}`);
    if (!from) continue;
    event.preventDefault();
    entry.open("class", from);
    return;
  }
}

function onHashChange() {
  const key = keyFromHash(location.hash);
  const entry = key ? registry.get(key) : undefined;
  if (entry?.linkable) entry.open("hash");
}

let listening = false;
/** One set of listeners for the page's modals, while it has any. */
function syncListeners() {
  if (registry.size > 0 && !listening) {
    listening = true;
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("hashchange", onHashChange);
  } else if (registry.size === 0 && listening) {
    listening = false;
    document.removeEventListener("click", onDocumentClick, true);
    window.removeEventListener("hashchange", onHashChange);
  }
}

type Props = {
  config: RowModal;
  /** The store, or null on Kaizen's own site: whose consent cookie says whether a closing may be remembered. */
  storeId: string | null;
  /** Whether it may open by itself here: not on a working page, not in the admin (a footer's modal also reads the address). */
  auto: boolean;
  labels: { close: string; dialog: string };
  /** The row's border, rounded corners and shadow, which are the panel's. */
  panelStyle?: CSSProperties;
  /** The builder's preview: open and closed from outside, and never by its own triggers. */
  preview?: { open: boolean; onClose: () => void };
  children: ReactNode;
};

export function PageModal({ config, storeId, auto, labels, panelStyle, preview, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const openedBy = useRef<How | null>(null);
  const pressedOutside = useRef(false);
  const titleId = useId();
  // The setting is data from the server: the same value keeps the effects as they are.
  const signature = JSON.stringify(config);
  const modal = useMemo(() => JSON.parse(signature) as RowModal, [signature]);
  const previewing = Boolean(preview);
  const previewOpen = preview?.open ?? false;

  // The dialog is named by its first heading, else by `labels.dialog` (which the markup starts with).
  useEffect(() => {
    const heading = panel.current?.querySelector("h1, h2, h3, h4, h5, h6");
    if (!heading || !dialog.current) return;
    if (!heading.id) heading.id = `${titleId}-title`;
    dialog.current.setAttribute("aria-labelledby", heading.id);
    dialog.current.removeAttribute("aria-label");
  }, [titleId]);

  // The builder's preview.
  useEffect(() => {
    if (!previewing || !dialog.current) return;
    const element = dialog.current;
    if (previewOpen && !element.open) element.showModal();
    if (!previewOpen && element.open) element.close();
  }, [previewing, previewOpen]);

  // On the site: found by its address, class, timer and exit intent.
  useEffect(() => {
    if (previewing) return;
    const element = dialog.current;
    if (!element) return;
    const mountedAt = Date.now();
    let fired = false;
    const cleanups: (() => void)[] = [];

    const close = () => {
      if (element.open) element.close();
    };
    const open = (how: How, from?: Element | null): boolean => {
      if (element.open) return true;
      if (openKey !== null && openKey !== modal.key) {
        // One at a time: a link switches, a trigger of its own does not push in.
        if (how === "auto") return false;
        registry.get(openKey)?.close();
      }
      opener.current =
        from ??
        (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null);
      try {
        element.showModal();
      } catch {
        return false;
      }
      openKey = modal.key;
      openedBy.current = how;
      panel.current?.focus({ preventScroll: true });
      // A link's address stays in the address bar, so it can be shared; closing takes it away.
      if ((how === "link" || how === "hash") && location.hash !== modalHash(modal.key)) {
        history.replaceState(history.state, "", `${location.pathname}${location.search}${modalHash(modal.key)}`);
      }
      return true;
    };
    const linkable = Boolean(modal.triggers.button);
    const entry: Entry = { key: modal.key, linkable, className: modal.triggers.className, open, close };
    registry.set(modal.key, entry);
    syncListeners();
    cleanups.push(() => {
      if (registry.get(modal.key) === entry) registry.delete(modal.key);
      if (openKey === modal.key) openKey = null;
      syncListeners();
    });

    // A link to it that was followed to reach the page.
    if (linkable && keyFromHash(location.hash) === modal.key) open("hash");

    // What opens it by itself: once per page view, and never on top of anything else.
    const tryAuto = () => {
      if (fired || !autoAllowed({ pathname: location.pathname, route: !auto })) return;
      if (Date.now() - mountedAt < AUTO_MIN_MS) return;
      if (openKey !== null || document.querySelector("dialog[open]")) return;
      if (!shouldAutoOpen(modal, { memory: browserMemory(), now: Date.now(), closed: closedThisLoad.has(modal.key) }))
        return;
      if (open("auto")) fired = true;
    };
    const { timer, exitIntent } = modal.triggers;
    if (timer) {
      const wait = Math.max(AUTO_MIN_MS, timer.seconds * 1000);
      let handle: number | undefined;
      const start = () => {
        handle = window.setTimeout(tryAuto, wait);
      };
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVisible);
        start();
      };
      // Counted from when the page is in view.
      if (document.visibilityState === "visible") start();
      else document.addEventListener("visibilitychange", onVisible);
      cleanups.push(() => {
        window.clearTimeout(handle);
        document.removeEventListener("visibilitychange", onVisible);
      });
    }
    if (exitIntent) {
      const onOut = (event: MouseEvent) => {
        if (isExitIntent(event, Date.now() - mountedAt)) tryAuto();
      };
      document.addEventListener("mouseout", onOut);
      cleanups.push(() => document.removeEventListener("mouseout", onOut));
      // No pointer to leave with: on a touch screen, a quick scroll up after reading down the page.
      if (window.matchMedia("(hover: none)").matches) {
        let state: ScrollIntentState = NO_SCROLL;
        const onScroll = () => {
          const scrollable = document.documentElement.scrollHeight - window.innerHeight;
          const step = stepScrollIntent(state, { y: window.scrollY, t: performance.now(), scrollable });
          state = step.state;
          if (step.fire && Date.now() - mountedAt >= AUTO_MIN_MS) tryAuto();
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        cleanups.push(() => window.removeEventListener("scroll", onScroll));
      }
    }
    return () => cleanups.forEach((undo) => undo());
  }, [modal, auto, previewing]);

  /** However it closed (Escape, the button, a click outside, a link to another modal, the page's own): the one place it is known. */
  const closed = () => {
    if (preview) {
      preview.onClose();
      return;
    }
    if (openKey === modal.key) openKey = null;
    if (location.hash === modalHash(modal.key))
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    // One that opened by itself and was closed is not opened again, as its frequency says: remembered if the visitor allowed
    // preferences (D58), else for this page load only.
    if (openedBy.current === "auto") {
      closedThisLoad.add(modal.key);
      rememberClose(modal, {
        memory: browserMemory(),
        now: Date.now(),
        allowed: mayRemember(document.cookie, storeId),
      });
    }
    openedBy.current = null;
    const back = opener.current;
    opener.current = null;
    // Not into a page that another modal has taken over, nor into a closed dialog.
    if (openKey === null && back instanceof HTMLElement && back.isConnected && !back.closest("dialog:not([open])")) {
      back.focus({ preventScroll: true });
    }
  };

  const size = MODAL_SIZES[modal.size] ?? MODAL_SIZES.md;
  const dim = MODAL_OVERLAYS[modal.overlay ?? "medium"].dim;
  return (
    <dialog
      ref={dialog}
      id={modalDomId(modal.key)}
      data-page-modal={modal.key}
      data-position={modal.position === "bottom" ? "bottom" : undefined}
      aria-label={labels.dialog}
      style={{ "--modal-width": size.width, "--modal-dim": dim } as CSSProperties}
      onClose={closed}
      onMouseDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a click that began and ended outside the panel: not a drag that ended there.
        if (event.target === event.currentTarget && pressedOutside.current && modal.closeOnOverlay !== false)
          event.currentTarget.close();
        pressedOutside.current = false;
      }}
    >
      <div ref={panel} tabIndex={-1} className="page-modal-panel bg-background text-foreground" style={panelStyle}>
        {children}
      </div>
      {modal.closeButton !== false && (
        <button
          type="button"
          aria-label={labels.close}
          onClick={() => dialog.current?.close()}
          className="page-modal-close absolute top-2 right-2 z-10 flex size-10 items-center justify-center rounded-full border border-border bg-background/90 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </dialog>
  );
}
