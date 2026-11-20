import { BACKDROP_WORDS } from "../backdrop-words";

/**
 * The builder's words for ready-made backdrops, the layers over a background and its hue (D534, D312): their English is in
 * `src/lib/backdrop-words.ts` (re-exported by `backdrops.ts`, which the builder draws from anyway), so this area is server-only (`SERVER_AREAS` in `admin-text.ts`) and a
 * page that draws the builder in another language hands it down (`useHandedText("backdrops")`); in English the builder reads
 * that module itself. Nothing is added to the first scripts of other screens (`e2e/signed-in/admin-scripts.spec.ts`).
 */
export const backdropsEn = BACKDROP_WORDS;

export type BackdropsMessages = typeof backdropsEn;
