import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { contentPack } from "@/lib/content-packs";
import { LAUNCH_THEMES } from "@/lib/launch-themes";
import {
  BRIEF_MAX,
  BRIEF_MIN,
  PICTURE_SHAPES,
  altFromBrief,
  pictureDirection,
  sitePicturePrompt,
  type SiteLook,
} from "@/lib/picture-direction";

import { AiError, aiFor, type AiConnection } from "./ai";
import { checkedAlt, makePicture } from "./ai-pictures";
import { getPlatformTheme } from "./platform-navigation";
import { PLATFORM_DEFAULTS } from "./seo";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Pictures made by prompt from the page builder's picture fields (D283): the person's description, made by the site's picture model in the
 * site's own look (`pictureDirection()`), kept in its media library with the description as its alt text, as the page studio's are (D92).
 * Who may make one is the route's to ask (`src/server/picture-route.ts`); this only makes it.
 */

/** Whose picture: a store (its record, for its theme and what it is about), or Kaizena Flow's own site; and who asked. */
export type PictureOwner = { store: Store | null; accountId: string };

export type MadeSitePicture =
  | { ok: true; picture: { url: string; thumbnailUrl: string | null; width: number; height: number; alt: string } }
  | { ok: false; problem: string };

const input = z.object({
  brief: z.string().trim().min(BRIEF_MIN).max(BRIEF_MAX),
  shape: z.enum(PICTURE_SHAPES),
  /** Off: the picture is made from the description alone. */
  follow: z.boolean(),
  /** Where it was asked for (D349): the page builder's fields (none), the media library, or the product editor; it names the AI feature it is metered as. */
  place: z.enum(["library", "product"]).optional(),
});

/** The photographer's brief of the theme a site has live: a Kaizena Flow theme's content pack's `look`, else none. */
function launchLook(launchKey: unknown): string | null {
  if (typeof launchKey !== "string") return null;
  const theme = LAUNCH_THEMES.find((one) => one.key === launchKey);
  return (theme && contentPack(theme.content)?.look) || null;
}

/** What the picture model is told of the site: its live theme's photography, its colours and what it is about. */
export async function siteLookOf(store: Store | null): Promise<SiteLook> {
  if (store) {
    const [live] = await db().execute<Row>(sql`
      select p.launch_key from commerce.store_theme_installs i join commerce.design_presets p on p.id = i.preset_id
      where i.store_id = ${store.id}::uuid and i.live
    `);
    const locale = store.localization.locales[0];
    const about = (locale && store.seo.description[locale]) || Object.values(store.seo.description).find(Boolean) || null;
    return { look: launchLook(live?.launch_key), settings: store.theme.settings, about };
  }
  const [live] = await db().execute<Row>(sql`
    select p.launch_key from commerce.platform_theme_installs i join commerce.design_presets p on p.id = i.preset_id where i.live
  `);
  return { look: launchLook(live?.launch_key), settings: (await getPlatformTheme()).settings, about: PLATFORM_DEFAULTS.description };
}

/** Whether a site's AI has a picture model, so the builder offers *Make with AI* (D283). */
export async function canMakePictures(storeId: string | null): Promise<boolean> {
  return Boolean((await aiFor(storeId))?.image);
}

/** Makes the picture asked for and keeps it in the site's library; a model or a description that fails says why, in words. */
export async function makeSitePicture(
  owner: PictureOwner,
  raw: unknown,
  deps: { make?: typeof makePicture; connection?: AiConnection | null } = {},
): Promise<MadeSitePicture> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: `Describe the picture in ${BRIEF_MIN} to ${BRIEF_MAX} characters.` };
  const { brief, shape, follow, place } = parsed.data;
  const storeId = owner.store?.id ?? null;
  const feature = place ? "library_pictures" : "page_pictures";
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(storeId, { feature, accountId: owner.accountId });
  if (!connection?.image) {
    return {
      ok: false,
      problem: owner.store
        ? "This store's AI has no picture model. Choose one under Settings, AI, to make pictures."
        : "Kaizena Flow's AI has no picture model. Choose one in the platform's AI settings to make pictures.",
    };
  }
  const prompt = sitePicturePrompt(brief, follow ? pictureDirection(await siteLookOf(owner.store)) : null);
  // The description's words as the alt text only when they make no claim (D349); else none, for the alt-text run to write.
  const alt = checkedAlt(altFromBrief(brief));
  try {
    const made = await (deps.make ?? makePicture)(connection, { storeId, accountId: owner.accountId }, { prompt, alt, shape });
    if (!made.ok) return { ok: false, problem: made.problem };
    return { ok: true, picture: { url: made.picture.url, thumbnailUrl: made.picture.thumbnailUrl, width: made.picture.width, height: made.picture.height, alt } };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: `The picture could not be made: ${error.message}` };
  }
}
