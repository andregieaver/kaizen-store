import { colorModeScript, storeColorKey } from "@/lib/color-mode";
import type { Store } from "@/server/stores";

import { ColorModeSwitch } from "./color-mode-switch";

/** A store's light or dark switch (D99), in its header: the visitor's choice over the store's mode. */
export function StoreColorSwitch({ store, labels }: { store: Pick<Store, "id" | "theme">; labels: { toDark: string; toLight: string } }) {
  const mode = store.theme.settings.mode;
  return <ColorModeSwitch storageKey={storeColorKey(store.id)} fallback={mode === "auto" ? null : mode} labels={labels} />;
}

/**
 * First in a store's page (D99): a visitor's choice of light or dark, before
 * anything is drawn; only while the store lets visitors choose, so a store
 * that stops shows its own mode again. Its `<html>` suppresses hydration
 * warnings, as the choice changes it.
 */
export function StoreColorScript({ store }: { store: Pick<Store, "id" | "theme"> }) {
  if (!store.theme.settings.visitorSwitch) return null;
  return <script dangerouslySetInnerHTML={{ __html: colorModeScript(storeColorKey(store.id)) }} />;
}
