import { ANIMATION_WORDS } from "../animation-words";

/**
 * The builder's words for the Animation component (D538, D312): their English is in `src/lib/animation-words.ts`, which the
 * component's fields draw from anyway, so this area is server-only (`SERVER_AREAS` in `admin-text.ts`) and a page that draws
 * the builder in another language hands it down (`useHandedText("animation")`); in English the fields read
 * `animation-words.ts` themselves. Nothing is added to the first scripts of other screens (`e2e/signed-in/admin-scripts.spec.ts`).
 */
export const animationEn = ANIMATION_WORDS;

export type AnimationMessages = typeof animationEn;
