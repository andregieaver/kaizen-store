"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";

import { FALLBACK_SIZE, PICKER_MOST, PICKER_PAGE, type PickerList, type PickerPicture } from "@/lib/media-picker";

import { Modal } from "./modal";

/**
 * Lets any picture field in an editor choose from the owner's media library, not only upload (D88): the editor provides how to list
 * the library, and every `ImageUploadButton` and picture field below it offers *Choose from the library*. Without a provider (an
 * editor that did not give one) the fields are as they were.
 */
const PickerContext = createContext<PickerList | null>(null);

export function MediaPickerProvider({ list, children }: { list: PickerList | null | undefined; children: ReactNode }) {
  return <PickerContext value={list ?? null}>{children}</PickerContext>;
}

export const useMediaPicker = () => useContext(PickerContext);

/** A picture as a field keeps it: its address and size (measured here when the library has not yet), with the library's thumbnail and alt text. */
export type PickedPicture = { url: string; thumbnailUrl: string | null; width: number; height: number; alt: string };

/** Measures a picture the library holds without a size. */
function measured(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const picture = new Image();
    picture.onload = () => resolve(picture.naturalWidth > 0 ? { width: picture.naturalWidth, height: picture.naturalHeight } : FALLBACK_SIZE);
    picture.onerror = () => resolve(FALLBACK_SIZE);
    picture.src = url;
  });
}

export async function pickedFrom(item: PickerPicture): Promise<PickedPicture> {
  const size = item.width && item.height ? { width: item.width, height: item.height } : await measured(item.url);
  return { url: item.url, thumbnailUrl: item.thumbnailUrl, ...size, alt: item.alt };
}

/** The button that opens the library to choose a picture; draws nothing where the editor has no library to list. */
export function LibraryButton({ label = "Choose from the library", onPicked }: { label?: string; onPicked: (picture: PickedPicture) => void }) {
  const list = useMediaPicker();
  const [open, setOpen] = useState(false);
  if (!list) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit rounded-md border border-border px-3 py-2 text-sm focus-visible:outline-2"
      >
        {label}
      </button>
      {open && <LibraryDialog list={list} onClose={() => setOpen(false)} onPicked={onPicked} />}
    </>
  );
}

function LibraryDialog({ list, onClose, onPicked }: { list: PickerList; onClose: () => void; onPicked: (picture: PickedPicture) => void }) {
  const searchId = useId();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PICKER_PAGE);
  const [result, setResult] = useState<{ items: PickerPicture[]; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);

  // The words are searched a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
      setLimit(PICKER_PAGE);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    let stale = false;
    list({ q: query, limit })
      .then((next) => {
        if (stale) return;
        setResult(next);
        setProblem(null);
      })
      .catch(() => {
        if (!stale) setProblem("The library could not be read. Try again.");
      });
    return () => {
      stale = true;
    };
  }, [list, query, limit]);

  const choose = async (item: PickerPicture) => {
    setChoosing(item.id);
    const picture = await pickedFrom(item);
    onPicked(picture);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Choose from the library" wide>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-medium">
            Search the pictures
          </label>
          <input
            id={searchId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="A word, or part of a file name"
            className="min-h-10 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problem}
          </p>
        )}
        {!result && !problem && <p className="text-sm text-muted">Reading the library …</p>}
        {result && result.items.length === 0 && (
          <p className="text-sm text-muted">{query ? "No picture matches. Try another word." : "The library has no pictures yet. Upload one first."}</p>
        )}
        {result && result.items.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {result.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={choosing !== null}
                  onClick={() => void choose(item)}
                  className="flex w-full flex-col gap-1 rounded-md border border-border p-1 text-left hover:bg-surface focus-visible:outline-2 disabled:opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the admin shows the owner's own file as it is */}
                  <img src={item.thumbnailUrl ?? item.url} alt={item.alt} loading="lazy" className="aspect-square w-full rounded object-cover" />
                  <span className="truncate text-xs">{item.fileName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {result && result.total > result.items.length && limit < PICKER_MOST && (
          <button
            type="button"
            onClick={() => setLimit((n) => Math.min(n + PICKER_PAGE, PICKER_MOST))}
            className="w-fit rounded-md border border-border px-3 py-2 text-sm"
          >
            Show more ({result.items.length} of {result.total})
          </button>
        )}
      </div>
    </Modal>
  );
}
