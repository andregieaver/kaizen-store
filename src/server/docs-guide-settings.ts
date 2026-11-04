import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { readDb } from "@/db/client";
import { cleanAvatarStyle, type AvatarStyle } from "@/lib/chat-avatar";
import { guideSettingsInput } from "@/lib/docs-guide-schema";
import { GUIDE_LANGS, type GuideLang, type GuideProfile } from "@/lib/docs-guide-shape";
import { END_AFTER_MINUTES, TRANSCRIPT_DAYS_OFF } from "@/lib/support-rules";

import { AI_TAG, aiFor } from "./ai";
import { audit, type Account } from "./auth";
import { refreshTag } from "./refresh";
import { col, typedRow } from "./typed-rows";

/**
 * The docs guide's settings (wave 14 unit E5, D444): one row of its own (`commerce.docs_guide`), edited by the platform's admins at
 * `/admin/platform/docs/guide`, read cached by the guide's route and panel (tag `DOCS_GUIDE_TAG`, refreshed on save). No row is the guide off,
 * with no name. The same settings as the platform chat's (D81) without voice: the docs' panel is typed.
 */

export const DOCS_GUIDE_TAG = "docs-guide";

export type DocsGuideSettings = {
  enabled: boolean;
  name: string;
  occupation: string;
  avatar: { url: string; width: number; height: number } | null;
  avatarStyle: AvatarStyle | null;
  greeting: Partial<Record<GuideLang, string>>;
  instructions: string;
  dailyLimit: number;
};

export const GUIDE_DEFAULTS: DocsGuideSettings = { enabled: false, name: "", occupation: "", avatar: null, avatarStyle: null, greeting: {}, instructions: "", dailyLimit: 500 };

const AVATAR = z.object({ url: z.string(), width: z.number(), height: z.number() });
const ROW = z.object({
  enabled: col.bool,
  name: col.text,
  occupation: col.text,
  avatar: z.unknown(),
  avatar_style: z.unknown(),
  greeting: z.unknown(),
  instructions: col.text,
  daily_limit: col.int,
});

function settingsOf(row: z.output<typeof ROW> | null): DocsGuideSettings {
  if (!row) return GUIDE_DEFAULTS;
  const avatar = AVATAR.safeParse(row.avatar);
  const greeting: Partial<Record<GuideLang, string>> = {};
  if (row.greeting && typeof row.greeting === "object") {
    for (const lang of GUIDE_LANGS) {
      const text = (row.greeting as Record<string, unknown>)[lang];
      if (typeof text === "string" && text.trim()) greeting[lang] = text;
    }
  }
  return {
    enabled: row.enabled,
    name: row.name,
    occupation: row.occupation,
    avatar: avatar.success ? avatar.data : null,
    avatarStyle: cleanAvatarStyle(row.avatar_style),
    greeting,
    instructions: row.instructions,
    dailyLimit: row.daily_limit,
  };
}

const SELECT = sql`select enabled, name, occupation, avatar, avatar_style, greeting, instructions, daily_limit from commerce.docs_guide where id = 1`;

/** The guide's settings as saved (its defaults while none are), cached for the docs' route and panel. */
export async function getDocsGuide(): Promise<DocsGuideSettings> {
  "use cache";
  cacheLife("hours");
  cacheTag(DOCS_GUIDE_TAG);
  return settingsOf(await typedRow(ROW, SELECT, readDb()));
}

/** The same for the admin, per request. */
export async function getDocsGuideForEdit(): Promise<DocsGuideSettings> {
  return settingsOf(await typedRow(ROW, SELECT));
}

export type SaveGuideResult = { ok: true } | { ok: false; problems: string[] };

/** Saves the guide's settings (the platform's admins only: the caller checked), audited with what Homer sees change. */
export async function saveDocsGuide(account: Account, raw: unknown): Promise<SaveGuideResult> {
  const parsed = guideSettingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const guide = parsed.data;
  const greeting = Object.fromEntries(Object.entries(guide.greeting).filter(([, text]) => text));
  await typedRow(
    z.object({ id: col.int }),
    sql`
      insert into commerce.docs_guide (id, enabled, name, occupation, avatar, avatar_style, greeting, instructions, daily_limit, updated_by)
      values (1, ${guide.enabled}, ${guide.name}, ${guide.occupation}, ${guide.avatar ? JSON.stringify(guide.avatar) : null}::jsonb,
        ${guide.avatarStyle ? JSON.stringify(guide.avatarStyle) : null}::jsonb, ${JSON.stringify(greeting)}::jsonb, ${guide.instructions},
        ${guide.dailyLimit}, ${account.id}::uuid)
      on conflict (id) do update set
        enabled = excluded.enabled, name = excluded.name, occupation = excluded.occupation, avatar = excluded.avatar,
        avatar_style = excluded.avatar_style, greeting = excluded.greeting, instructions = excluded.instructions,
        daily_limit = excluded.daily_limit, updated_at = now(), updated_by = excluded.updated_by
      returning id
    `,
  );
  await audit(account.id, null, "platform.docs_guide_saved", { enabled: guide.enabled, name: guide.name, dailyLimit: guide.dailyLimit });
  refreshTag(DOCS_GUIDE_TAG);
  return { ok: true };
}

/** How Kaizena Flow's own desk keeps the platform chat's conversations (D216), which the guide's follow: its idle time and its period. */
export type GuideKeeping = { endAfterMinutes: number; transcriptDays: number };

const DESK = z.object({ mode: col.text, transcript_days: col.int, end_after_minutes: col.int });

/** Kaizena Flow's desk's idle time and transcript period, as its conversations are kept (a day while it has support off, or no settings). */
export async function guideKeeping(executor = readDb()): Promise<GuideKeeping> {
  const desk = await typedRow(DESK, sql`select mode, transcript_days, end_after_minutes from commerce.support_settings where store_id is null`, executor);
  return {
    endAfterMinutes: desk?.end_after_minutes ?? END_AFTER_MINUTES.default,
    transcriptDays: !desk || desk.mode === "off" ? TRANSCRIPT_DAYS_OFF : desk.transcript_days,
  };
}

/**
 * The guide as the docs' panel shows it, in a language: on while it is switched on and the platform's AI has a text model, who answers, its
 * greeting, how long the conversation is kept, and that an AI does nothing with the messages but answer them (`aiUse`, D391). Cached with the
 * settings and the platform's AI.
 */
export async function docsGuideProfile(lang: GuideLang): Promise<GuideProfile> {
  "use cache";
  cacheLife("hours");
  cacheTag(DOCS_GUIDE_TAG, AI_TAG);
  const [guide, connection, keeping] = await Promise.all([getDocsGuide(), aiFor(null), guideKeeping()]);
  return {
    on: guide.enabled && Boolean(connection?.textModel),
    name: guide.name,
    occupation: guide.occupation,
    avatar: guide.avatar,
    avatarStyle: guide.avatarStyle,
    greeting: guide.greeting[lang] ?? "",
    keptDays: keeping.transcriptDays,
    aiUse: { tone: false, summaries: false },
  };
}
