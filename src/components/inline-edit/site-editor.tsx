"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { RichTextDoc } from "@/lib/page-content";

import { FloatingBar } from "./floating-bar";
import { InlineHeadingEditor } from "./heading-editor";
import { InlineRichEditor } from "./rich-text-inline";

/**
 * "Edit text" on the live site (D192), for signed-in staff who may change the page's website: headings and texts of the page's own
 * (the server marks them, `data-kz-edit`) are pressed and typed in where they stand, then saved or cancelled. It is loaded only when
 * the person turns the mode on, so visitors never fetch the editor. The words are asked of the server when pressed (never in the page),
 * and saved with the revision they were read at, so words changed meanwhile are never written over. Nothing is saved until the person
 * says so (Save, Ctrl+Enter, or Enter in a heading): the focus leaving the text does not publish it.
 */

type Fetched =
  | { ok: true; kind: "heading"; text: string; rev: string }
  | { ok: true; kind: "richText"; doc: RichTextDoc; rev: string }
  | { ok: false; message?: string };

type Session = {
  /** The component on the page, and the place inside it the editor is drawn in while the words under it are hidden. */
  element: HTMLElement;
  slot: HTMLElement;
  block: string;
  rev: string;
  point: { x: number; y: number } | null;
} & ({ kind: "heading"; level: number; className: string; text: string } | { kind: "richText"; doc: RichTextDoc });

const ENDPOINT = "/api/platform/editor/text";

export default function SiteTextEditor({ pageId, store, onNotice }: { pageId: string; store?: string; onNotice: (text: string) => void }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loading = useRef(false);
  // The words as typed so far: what Save sends.
  const latest = useRef<{ text?: string; doc?: RichTextDoc }>({});
  // Words typed and neither saved nor cancelled: said if the mode is turned off over them.
  const unsaved = useRef(false);
  useEffect(
    () => () => {
      if (unsaved.current) onNotice("The text you were editing was not saved.");
    },
    [onNotice],
  );

  async function begin(element: HTMLElement, point: { x: number; y: number }) {
    const block = element.getAttribute("data-kz-block");
    if (!block || loading.current) return;
    loading.current = true;
    setMessage(null);
    try {
      const params = new URLSearchParams({ page: pageId, block });
      if (store) params.set("store", store);
      const response = await fetch(`${ENDPOINT}?${params}`, { cache: "no-store" });
      const found = (await response.json().catch(() => null)) as Fetched | null;
      if (!found || !found.ok) {
        onNotice(found?.message ?? "This text cannot be edited here.");
        return;
      }
      // The heading as the page draws it, so it is edited in the same element and classes.
      const original = element.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6");
      const slot = document.createElement("div");
      slot.setAttribute("data-kz-slot", "");
      element.appendChild(slot);
      element.setAttribute("data-kz-active", "");
      latest.current = {};
      setSession(
        found.kind === "heading"
          ? { element, slot, block, rev: found.rev, point, kind: "heading", level: Number(original?.tagName.slice(1)) || 2, className: original?.className ?? "", text: found.text }
          : { element, slot, block, rev: found.rev, point, kind: "richText", doc: found.doc },
      );
    } catch {
      onNotice("This text could not be opened. Check the connection and try again.");
    } finally {
      loading.current = false;
    }
  }

  // The components of the page that are pressed: the first press fetches the words and opens the editor.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const element = target?.closest<HTMLElement>("[data-kz-edit]");
      if (!element || element.closest("article[data-kz-page]")?.getAttribute("data-kz-page") !== pageId) return;
      // A press inside the editor already open is the editor's.
      if (session?.element === element) return;
      event.preventDefault();
      event.stopPropagation();
      if (session) {
        setMessage("Save or cancel this change first.");
        return;
      }
      void begin(element, { x: event.clientX, y: event.clientY });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // `begin` only reads what is current when pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, store, session]);

  // Whatever ends the session (saved, cancelled, the mode turned off) gives the page back its words.
  useEffect(() => {
    if (!session) return;
    return () => {
      session.slot.remove();
      session.element.removeAttribute("data-kz-active");
    };
  }, [session]);

  const cancel = () => {
    unsaved.current = false;
    setMessage(null);
    setSession(null);
  };

  async function save() {
    if (!session || saving) return;
    const edit = session.kind === "heading" ? { kind: "heading", text: latest.current.text ?? session.text } : { kind: "richText", doc: latest.current.doc ?? session.doc };
    const unchanged = session.kind === "heading" ? edit.kind === "heading" && edit.text === session.text : JSON.stringify(edit.kind === "richText" ? edit.doc : null) === JSON.stringify(session.doc);
    if (unchanged) {
      cancel();
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ store: store ?? null, page: pageId, block: session.block, rev: session.rev, edit }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; draftKept?: boolean } | null;
      if (response.ok && body?.ok) {
        unsaved.current = false;
        setSession(null);
        onNotice(body.draftKept ? "Saved. The draft in the page builder has other words for this and keeps them." : "Saved.");
        router.refresh();
      } else {
        setMessage(body?.message ?? "It could not be saved. Try again.");
      }
    } catch {
      setMessage("It could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const anchor = useMemo(() => ({ current: session?.slot ?? null }), [session]);
  const controls = (
    <div className="flex flex-wrap items-center gap-2 border-t border-border p-2 text-sm first:border-t-0">
      <button type="button" onClick={() => void save()} disabled={saving} className="min-h-9 rounded bg-foreground px-3 font-medium text-background disabled:opacity-60">
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={cancel} disabled={saving} className="min-h-9 rounded border border-border px-3 disabled:opacity-60">
        Cancel
      </button>
      <span role="status" className={message ? "max-w-72 text-red-700 dark:text-red-400" : "text-muted"}>
        {message ?? "Ctrl+Enter saves, Esc cancels."}
      </span>
    </div>
  );

  return (
    <>
      <style>{`
        article[data-kz-page="${pageId}"] [data-kz-edit]:not([data-kz-active]) { cursor: text; outline: 2px dashed transparent; outline-offset: 6px; transition: outline-color 0.15s; }
        article[data-kz-page="${pageId}"] [data-kz-edit]:not([data-kz-active]):hover { outline-color: rgb(37 99 235 / 0.65); }
        [data-kz-active] > :not([data-kz-slot]) { display: none !important; }
      `}</style>
      {session &&
        createPortal(
          session.kind === "heading" ? (
            <>
              <InlineHeadingEditor
                level={session.level}
                className={session.className}
                text={session.text}
                point={session.point}
                endOnBlur={false}
                onChange={(text) => {
                  latest.current.text = text;
                  unsaved.current = text !== session.text;
                }}
                onDone={(how) => (how === "save" ? void save() : cancel())}
              />
              <FloatingBar anchor={anchor}>{controls}</FloatingBar>
            </>
          ) : (
            <InlineRichEditor
              doc={session.doc}
              point={session.point}
              label="Text on the page"
              endOnBlur={false}
              actions={controls}
              onChange={(doc) => {
                latest.current.doc = doc;
                unsaved.current = true;
              }}
              onDone={(how) => (how === "save" ? void save() : cancel())}
            />
          ),
          session.slot,
        )}
    </>
  );
}
