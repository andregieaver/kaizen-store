"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  SHORTCUTS,
  keyLabel,
  opensShortcutSheet,
  type ShortcutAction,
  type ShortcutGroup,
} from "@/lib/shortcut-sheet";

import { typingIn } from "./responsive-edit";

const noChange = () => () => undefined;
const onMac = () =>
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

type Words = {
  title: string;
  close: string;
  hint: string;
  keys: Record<ShortcutAction, string>;
} & Record<ShortcutGroup, string>;

/**
 * The admin's keyboard shortcuts, shown on `?` from any page of the admin (PSI UX-07): a dialog listing what `SHORTCUTS` holds, with the
 * keys as this computer has them. Nothing is shown until it is asked for, and typing a question mark in a field types it.
 */
export function ShortcutSheet({ words }: { words: Words }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The keys as this computer has them; the server draws Ctrl, and a Mac shows ⌘ once it runs.
  const mac = useSyncExternalStore(noChange, onMac, () => false);
  // The list is drawn only while it is open, so no page carries it unasked.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !opensShortcutSheet(event, typingIn(event.target)) ||
        dialog.current?.open ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      setOpen(true);
      dialog.current?.showModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const groups: ShortcutGroup[] = ["everywhere", "builder", "writing"];
  return (
    <dialog
      ref={dialog}
      aria-labelledby="shortcut-sheet-title"
      onClose={() => setOpen(false)}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-panel border border-line bg-card p-6 text-ink shadow-xl backdrop:bg-black/40"
    >
      {open && (
        <>
          <div className="flex items-start justify-between gap-4">
            <h2 id="shortcut-sheet-title" className="text-title">
              {words.title}
            </h2>
            <button
              type="button"
              className="rounded-button px-3 py-1 text-sm hover:bg-sunken"
              onClick={() => dialog.current?.close()}
            >
              {words.close}
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">{words.hint}</p>
          {groups.map((group) => (
            <section key={group} className="mt-5">
              <h3 className="text-sm font-medium text-muted">{words[group]}</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <Fragment key={s.action}>
                    <dt>{words.keys[s.action]}</dt>
                    <dd className="flex gap-1">
                      {s.keys.map((key) => (
                        <kbd
                          key={key}
                          className="min-w-7 rounded border border-line bg-sunken px-1.5 py-0.5 text-center font-mono text-xs"
                        >
                          {keyLabel(key, mac)}
                        </kbd>
                      ))}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </>
      )}
    </dialog>
  );
}
