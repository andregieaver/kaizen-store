import type { Widen } from "./common.en";

/**
 * The words of signing a design tool's app in to a store (D898 F1, `docs/design-tools.md`): the page that approves the Kaizena Flow plugin
 * in Figma, shown in the admin the plugin opens. `{name}`-style placeholders are filled by `fillWords()`.
 */
export const pluginsEn = {
  title: "Connect Figma",
  lead: "The Kaizena Flow plugin in Figma asks to send designs to one of your stores, as page drafts and pictures in its library.",
  check: "Figma should show this code:",
  store: "Store",
  connect: "Connect Figma",
  decline: "Do not connect",
  warn: "Connect only if you pressed Sign in in the Kaizena Flow plugin just now. The plugin can then save page drafts and add pictures to the store's library; nothing is published by it.",
  where: "It is listed under Developer, API tokens as Figma plugin, where you can revoke it.",
  connected: "Figma is connected to {store}. Go back to Figma: the plugin is ready.",
  declined: "Figma was not connected. You can close this tab.",
  noStores: "Only a store's owner can connect Figma, and you own no store.",
  problems: {
    owner: "Only the store's owner can connect Figma.",
    limit: "The store has as many API tokens as it may have. Revoke one under Developer, API tokens, and try again.",
    off: "Connecting Figma is not set up on Kaizena Flow yet.",
    gone: "This sign-in has ended or was already answered. Press Sign in in the plugin again.",
  },
};

export type PluginsMessages = Widen<typeof pluginsEn>;
