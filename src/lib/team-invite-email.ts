import type { AdminLang } from "./admin-lang";
import { SIGN_IN_WORDS } from "./admin-words/sign-in";
import type { EmailContent } from "./email-layout";

/**
 * The email that tells someone they were added to a team (D907): to Kaizena Flow's own team (Platform → Team) or to a store's (Settings →
 * Staff). It says who added them, to what and in which role, and how to get in: the sign-in page with the address that opens where they
 * work, by a link sent to this same address (an added account has no password). In the inviter's admin language, the only one known.
 * Pure: the words, the role and the place are given.
 */

export const TEAM_INVITE_KINDS = { platform: "platform.team_invite", store: "staff.team_invite" } as const;

const WORDS = {
  en: {
    subject: "You have been added to {place}",
    preview: "{inviter} added you as {role}.",
    heading: "Welcome to {place}",
    body: "{inviter} added you to {place} on Kaizena Flow, as {role}.",
    bodyAnon: "You were added to {place} on Kaizena Flow, as {role}.",
    platformSubject: "You have been added to Kaizena Flow's team",
    platformBody: "{inviter} added you to Kaizena Flow's team, as {role}.",
    platformBodyAnon: "You were added to Kaizena Flow's team, as {role}.",
    how: "Press the button below, choose {link} and use this address. The first time, you set up two-step sign-in with an authenticator app.",
    howStore: "Press the button below, choose {link} and use this address.",
    button: "Sign in",
    notYou: "Not expecting this? You can ignore it: nothing happens until you sign in.",
  },
  nb: {
    subject: "Du er lagt til i {place}",
    preview: "{inviter} la deg til som {role}.",
    heading: "Velkommen til {place}",
    body: "{inviter} la deg til i {place} på Kaizena Flow, som {role}.",
    bodyAnon: "Du er lagt til i {place} på Kaizena Flow, som {role}.",
    platformSubject: "Du er lagt til i teamet til Kaizena Flow",
    platformBody: "{inviter} la deg til i teamet til Kaizena Flow, som {role}.",
    platformBodyAnon: "Du er lagt til i teamet til Kaizena Flow, som {role}.",
    how: "Trykk på knappen under, velg {link} og bruk denne adressen. Første gang setter du opp innlogging i to trinn med en autentiseringsapp.",
    howStore: "Trykk på knappen under, velg {link} og bruk denne adressen.",
    button: "Logg inn",
    notYou: "Ventet du ikke dette? Da kan du se bort fra det: ingenting skjer før du logger inn.",
  },
} as const satisfies Record<AdminLang, Record<string, string>>;

/** The roles' names, small and kept here so the email reaches no page's catalogue of words (D907). */
const ROLE_WORDS: Record<AdminLang, Record<InviteRole, string>> = {
  en: { owner: "Owner", admin: "Admin", support: "Support", content: "Content", finance: "Finance", read_only: "Read-only", legal: "Legal" },
  nb: { owner: "Eier", admin: "Administrator", support: "Kundestøtte", content: "Innhold", finance: "Økonomi", read_only: "Kun lesing", legal: "Jurist" },
};

export type InviteRole = "owner" | "admin" | "support" | "content" | "finance" | "read_only" | "legal";

/** A role's name in a language: one of the teams' own, or a store's custom role by the name it was given. */
export const inviteRoleName = (lang: AdminLang, role: InviteRole, custom: string | null = null): string => custom ?? ROLE_WORDS[lang][role];

export type TeamInvite = {
  lang: AdminLang;
  /** Who added them, by name or address; none when it is not known. */
  inviter: string | null;
  /** The store's name; Kaizena Flow's own team when `platform`. */
  place: string;
  /** The role, in words of the same language. */
  role: string;
  /** The sign-in page's full address, opening where they work. */
  url: string;
  /** Kaizena Flow's own team, which signs in with two steps; a store's staff signs in as the store asks. */
  platform: boolean;
};

export function teamInviteEmail(invite: TeamInvite): EmailContent {
  const w = WORDS[invite.lang];
  const fill = (text: string) =>
    text
      .replaceAll("{inviter}", invite.inviter?.trim() || "")
      .replaceAll("{place}", invite.place.trim())
      .replaceAll("{role}", invite.role.trim().toLowerCase());
  const body = invite.platform ? (invite.inviter ? w.platformBody : w.platformBodyAnon) : invite.inviter ? w.body : w.bodyAnon;
  return {
    subject: fill(invite.platform ? w.platformSubject : w.subject),
    preview: invite.inviter ? fill(w.preview) : fill(body),
    lang: invite.lang === "nb" ? "nb-NO" : "en",
    footer: ["Kaizena Flow · kaizenaflow.com"],
    blocks: [
      { type: "heading", text: fill(w.heading) },
      { type: "paragraph", text: fill(body) },
      { type: "paragraph", text: (invite.platform ? w.how : w.howStore).replace("{link}", `«${SIGN_IN_WORDS[invite.lang].signIn.emailLink}»`) },
      { type: "button", text: w.button, url: invite.url },
      { type: "paragraph", text: w.notYou },
    ],
  };
}

/** The sign-in page's address that opens at `path` once signed in. */
export const signInTo = (origin: string, path: string): string => `${origin}/admin/sign-in?next=${encodeURIComponent(path)}`;
