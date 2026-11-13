/**
 * The interface text of languages that have no hand-written text (D111), as
 * `Messages` built from the catalogue, by language. One registry per
 * JavaScript realm, kept on `globalThis` so the server's separately bundled
 * modules and the browser's provider all see the same one: the server fills it
 * from the database (`src/server/ui-text-read.ts`), the browser from what the
 * storefront's layout sends (`UiProvider`). `t()` and `emailText()` read it, so
 * a language that is not there is English, as before. The server registers
 * makers, not built messages: a language is built when it is first read
 * (bloat review step 0.8), so an instance that is never asked for it never
 * builds it.
 */

/** `texts`: the catalogue's own texts by key, kept in the browser for a part whose English is not in `ui` (`returnsText()`, D212). */
type Entry = { ui?: unknown; email?: unknown; texts?: Record<string, string>; makeUi?: () => unknown; makeEmail?: () => unknown };

const KEY = "__kaizenUiRegistry";

function registry(): Map<string, Entry> {
  const scope = globalThis as unknown as Record<string, Map<string, Entry> | undefined>;
  return (scope[KEY] ??= new Map());
}

/** The built messages of a namespace; a registered maker runs on the first read, and its result is kept. A maker that throws is dropped and the language reads as English. */
function built(lang: string, value: "ui" | "email", make: "makeUi" | "makeEmail"): unknown {
  const entry = registry().get(lang);
  if (!entry) return undefined;
  if (entry[value] !== undefined) return entry[value];
  const maker = entry[make];
  if (!maker) return undefined;
  delete entry[make];
  try {
    entry[value] = maker();
  } catch {
    return undefined;
  }
  return entry[value];
}

export const registeredUi = (lang: string): unknown => built(lang, "ui", "makeUi");
export const registeredEmail = (lang: string): unknown => built(lang, "email", "makeEmail");
export const registeredTexts = (lang: string): Record<string, string> | undefined => registry().get(lang)?.texts;

/** Sets a language's messages (either or both namespaces); the language's other namespace is kept. A new maker drops the namespace built before, so a reload never serves the old build. */
export function registerMessages(lang: string, entry: Entry): void {
  const kept = { ...registry().get(lang) };
  if (entry.makeUi) delete kept.ui;
  if (entry.makeEmail) delete kept.email;
  registry().set(lang, { ...kept, ...entry });
}

export const forgetMessages = (lang: string) => void registry().delete(lang);

export const registeredLanguages = (): string[] => [...registry().keys()];
