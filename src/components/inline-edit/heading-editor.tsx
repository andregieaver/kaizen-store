"use client";

import { useLayoutEffect, useRef } from "react";

import { cleanHeadingText } from "@/lib/inline-edit";

/**
 * A heading edited where it stands (D191): the heading's own element, as the page draws it, made editable. It holds the text as it is
 * stored, inline markup (`<strong>`, `<br>`) as typed, which the page draws as elements again when the editing ends. One line: Enter
 * ends it, a paste is plain text and the text is held to the heading's limit. Escape puts back what it was.
 */
export function InlineHeadingEditor({
  level,
  className,
  text,
  point,
  endOnBlur = true,
  onChange,
  onDone,
}: {
  level: number;
  /** The classes the page gives the heading. */
  className: string;
  /** The text to start from; later changes come from the element itself. */
  text: string;
  /** Where it was pressed, to put the caret there. */
  point: { x: number; y: number } | null;
  /** Whether the focus leaving it ends the editing (the builder's canvas); on the live site only the person says when. */
  endOnBlur?: boolean;
  onChange: (text: string) => void;
  onDone: (how: "save" | "cancel") => void;
}) {
  const element = useRef<HTMLElement | null>(null);
  // What it started from: the words, to put back on Escape, and the press that started it.
  const start = useRef({ text, point });
  const done = useRef(false);

  // Mounted with its words and the caret where the press was; React never touches the words after (no children are given).
  useLayoutEffect(() => {
    const el = element.current;
    if (!el) return;
    el.textContent = start.current.text;
    // Plain text only where the browser can; elsewhere formatting keys and pastes are held back below.
    el.contentEditable = "plaintext-only";
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    el.focus({ preventScroll: true });
    placeCaret(el, start.current.point);
  }, []);

  const finish = (how: "save" | "cancel") => {
    if (done.current) return;
    done.current = true;
    if (how === "cancel") onChange(start.current.text);
    onDone(how);
  };
  const read = (el: HTMLElement) => {
    const cleaned = cleanHeadingText(el.textContent ?? "");
    if (cleaned !== el.textContent) {
      el.textContent = cleaned;
      placeCaret(el, null);
    }
    onChange(cleaned);
  };

  const Tag = `h${Math.min(Math.max(Math.round(level), 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag
      ref={(node: HTMLHeadingElement | null) => {
        element.current = node;
      }}
      className={`${className} cursor-text rounded-sm outline-2 outline-offset-4 outline-blue-600/70 focus:outline-blue-600`}
      role="textbox"
      aria-label="Heading text"
      aria-multiline="false"
      spellCheck
      suppressContentEditableWarning
      data-inline-editing="heading"
      onInput={(event) => read(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish("save");
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish("cancel");
        } else if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) {
          // Formatting has no place in a heading's text.
          event.preventDefault();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const pasted = cleanHeadingText(event.clipboardData.getData("text/plain"));
        if (pasted) insertText(pasted);
      }}
      onDrop={(event) => event.preventDefault()}
      // The window losing the focus (another tab) does not end it; a press elsewhere does.
      onBlur={() => {
        if (endOnBlur && document.hasFocus()) finish("save");
      }}
    />
  );
}

/** Puts text at the caret, as typing it would. */
function insertText(text: string) {
  if (document.execCommand("insertText", false, text)) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
}

/** The caret where the point is (the press that started the editing), else at the end. */
function placeCaret(el: HTMLElement, point: { x: number; y: number } | null) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let found: { node: Node; offset: number } | null = null;
  if (point) {
    const position = doc.caretPositionFromPoint?.(point.x, point.y);
    if (position && el.contains(position.offsetNode)) found = { node: position.offsetNode, offset: position.offset };
    else {
      const at = doc.caretRangeFromPoint?.(point.x, point.y);
      if (at && el.contains(at.startContainer)) found = { node: at.startContainer, offset: at.startOffset };
    }
  }
  if (found) {
    range.setStart(found.node, found.offset);
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
