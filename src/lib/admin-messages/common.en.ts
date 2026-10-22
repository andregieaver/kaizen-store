/**
 * The admin's words every area shares (D312 A0, `docs/platform-admin-i18n.md` 3.3): the account menu, the language choice. English is
 * the type, so a language without a key does not compile. Read on the server with `adminText(lang, "common")` (`src/lib/admin-text.ts`)
 * and in a client part with `useAdminText("common")`; a slice that reaches the browser holds strings only (a choice by number goes through
 * `src/lib/icu-lite.ts`). Legal and financial words come only from the glossary (`src/lib/i18n-glossary.ts`).
 */
export const commonEn = {
  accountMenu: {
    yourAccount: "Your account",
    contactSupport: "Contact Kaizena Flow support",
    colours: "Colours",
    toDark: "Switch to dark colours",
    toLight: "Switch to light colours",
    language: "Language",
    signOut: "Sign out",
  },
  language: {
    title: "Language",
    description: "The language the admin is shown in for you. Your stores' shoppers see the languages chosen for each store.",
    saving: "Saving …",
    kept: "Kept with your account, so the admin is in the same language on every device you sign in on.",
    partly: "Parts of the admin not yet written in your language are shown in English.",
  },
};

export type Widen<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : T extends object ? { [K in keyof T]: Widen<T[K]> } : string;

export type CommonMessages = Widen<typeof commonEn>;
