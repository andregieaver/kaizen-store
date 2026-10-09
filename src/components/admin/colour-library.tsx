"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useId, useState, type ReactNode } from "react";

import {
  EMPTY_LIBRARY,
  libraryName,
  linearGradient,
  savedFromBackground,
  withSavedColour,
  withSavedGradient,
  withoutSaved,
  LIBRARY_NAME_MAX,
  type ColourLibrary,
  type SavedGradient,
} from "@/lib/colour-library";
import { HEX6 } from "@/lib/colour";
import { TEXT_GRADIENT_ANGLE_DEFAULT, TEXT_GRADIENT_COLORS, type TextGradient } from "@/lib/typography";

/**
 * The store's saved colours and gradients (D183) in the page builder: a provider the editor puts around the builder, and the
 * pieces that use it (a colour field's saved swatches, a gradient editor's saved gradients, a text gradient's fields). Using a
 * saved one copies it into the part; saving, naming and removing keep the list on the store's theme at once.
 */

type Library = {
  library: ColourLibrary;
  /** The last thing that went wrong when keeping the list, or null. */
  problem: string | null;
  saveColour: (name: string, color: string) => void;
  saveGradient: (name: string, gradient: Parameters<typeof savedFromBackground>[0]) => void;
  remove: (kind: "colour" | "gradient", id: string) => void;
};

const Context = createContext<Library | null>(null);

/** The saved colours and gradients, or null where the owner has none to keep (Kaizen's own pages). */
export const useColourLibrary = () => useContext(Context);

export function ColourLibraryProvider({
  initial,
  save,
  children,
}: {
  initial: ColourLibrary | undefined;
  /** Keeps the list; the problems that stopped it, or null once kept. */
  save: ((library: ColourLibrary) => Promise<string[] | null>) | null;
  children: ReactNode;
}) {
  const [library, setLibrary] = useState<ColourLibrary>(initial ?? EMPTY_LIBRARY);
  const [problem, setProblem] = useState<string | null>(null);
  const keep = useCallback(
    async (next: ColourLibrary, before: ColourLibrary) => {
      setLibrary(next);
      setProblem(null);
      if (!save) return;
      try {
        const failed = await save(next);
        if (failed) {
          setLibrary(before);
          setProblem(failed[0] ?? "It could not be kept.");
        }
      } catch {
        setLibrary(before);
        setProblem("It could not be kept. Changing the saved colours needs access to the page builder.");
      }
    },
    [save],
  );
  if (!save) return <>{children}</>;
  const value: Library = {
    library,
    problem,
    saveColour: (name, color) => {
      const added = withSavedColour(library, { id: crypto.randomUUID(), name: libraryName(name, `Colour ${library.colours.length + 1}`), color });
      if (added.full) setProblem("There is room for 40 saved colours; remove one first.");
      else void keep(added.library, library);
    },
    saveGradient: (name, gradient) => {
      const added = withSavedGradient(library, savedFromBackground(gradient, crypto.randomUUID(), libraryName(name, `Gradient ${library.gradients.length + 1}`)));
      if (added.full) setProblem("There is room for 20 saved gradients; remove one first.");
      else void keep(added.library, library);
    },
    remove: (kind, id) => void keep(withoutSaved(library, kind, id), library),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** A small form that asks for a name and saves: a button until pressed. */
function SaveAs({ what, disabled, onSave }: { what: string; disabled?: boolean; onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const id = useId();
  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="min-h-8 rounded-md border border-border px-2 text-xs hover:bg-surface disabled:opacity-50"
      >
        Save {what}…
      </button>
    );
  }
  const done = () => {
    onSave(name);
    setName("");
    setOpen(false);
  };
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        Name of the saved {what}
      </label>
      <input
        id={id}
        autoFocus
        value={name}
        maxLength={LIBRARY_NAME_MAX}
        placeholder="Name"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            done();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className="min-h-8 w-32 rounded-md border border-border bg-background px-2 text-xs"
      />
      <button type="button" onClick={done} className="min-h-8 rounded-md bg-foreground px-2 text-xs font-medium text-background">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="min-h-8 rounded-md border border-border px-2 text-xs">
        Cancel
      </button>
    </span>
  );
}

/** A colour field's saved colours: press one to use it, × to remove it, and save the colour shown. */
export function SavedColours({ label, value, onPick }: { label: string; value: string | undefined; onPick: (color: string) => void }) {
  const lib = useColourLibrary();
  if (!lib) return null;
  const { colours } = lib.library;
  return (
    <div className="flex flex-col gap-1 pt-1" data-saved-colours="">
      {colours.length > 0 && (
        <div role="group" aria-label={`${label}: saved colours`} className="flex flex-wrap items-center gap-1.5">
          {colours.map((saved) => (
            <span key={saved.id} className="group relative">
              <button
                type="button"
                onClick={() => onPick(saved.color)}
                aria-label={`${saved.name} (${saved.color})`}
                aria-pressed={value?.toLowerCase() === saved.color}
                title={`${saved.name} ${saved.color}`}
                className="size-6 rounded border border-border shadow-sm aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-foreground"
                style={{ backgroundColor: saved.color }}
              />
              <button
                type="button"
                onClick={() => lib.remove("colour", saved.id)}
                aria-label={`Remove saved colour ${saved.name}`}
                className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full bg-foreground text-background group-focus-within:flex group-hover:flex"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <SaveAs what="colour" disabled={value === undefined || !HEX6.test(value)} onSave={(name) => value && lib.saveColour(name, value)} />
      {lib.problem && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          {lib.problem}
        </span>
      )}
    </div>
  );
}

/** A gradient's swatch: its colours at its angle. */
const swatch = (g: { colors: readonly string[]; angle?: number }) => ({ backgroundImage: linearGradient(g.colors, g.angle ?? 90) });

/** A gradient editor's saved gradients: press one to use it (`onPick`), × to remove it, and save the one being edited. */
export function SavedGradients({
  label,
  current,
  onPick,
}: {
  label: string;
  /** The gradient being edited, to save; none leaves out the save button. */
  current: Parameters<typeof savedFromBackground>[0] | undefined;
  onPick: (saved: SavedGradient) => void;
}) {
  const lib = useColourLibrary();
  if (!lib) return null;
  const { gradients } = lib.library;
  return (
    <div className="flex flex-col gap-1.5" data-saved-gradients="">
      {gradients.length > 0 && (
        <div role="group" aria-label={`${label}: saved gradients`} className="flex flex-wrap items-center gap-2">
          {gradients.map((saved) => (
            <span key={saved.id} className="group relative">
              <button
                type="button"
                onClick={() => onPick(saved)}
                aria-label={`Use the saved gradient ${saved.name}`}
                title={saved.name}
                className="h-7 w-14 rounded border border-border shadow-sm"
                style={swatch(saved)}
              />
              <button
                type="button"
                onClick={() => lib.remove("gradient", saved.id)}
                aria-label={`Remove saved gradient ${saved.name}`}
                className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full bg-foreground text-background group-focus-within:flex group-hover:flex"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {current && <SaveAs what="gradient" onSave={(name) => lib.saveGradient(name, current)} />}
      {lib.problem && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          {lib.problem}
        </span>
      )}
    </div>
  );
}

/** What a text gradient starts as, and one taken from a saved gradient: its colours and angle. */
export const newTextGradient = (): TextGradient => ({ colors: ["#6366f1", "#ec4899"], angle: TEXT_GRADIENT_ANGLE_DEFAULT });
export const textGradientOf = (saved: SavedGradient): TextGradient => ({
  colors: saved.colors.slice(0, TEXT_GRADIENT_COLORS.max),
  angle: saved.angle ?? TEXT_GRADIENT_ANGLE_DEFAULT,
});

export { swatch as gradientSwatch };
