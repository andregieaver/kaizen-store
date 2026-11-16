/**
 * The A/B versions a visitor is being shown on this page (D656, `docs/heatmaps-and-recordings.md` 7.3): `AbMarker` registers a version only
 * where it has checked that the page drawn is the one the visitor's cookie names (D148), and takes it away when it unmounts. Heatmaps and
 * recordings read it to tag what they send; the server checks every tag against the cookie again. Browser-safe and pure apart from the event.
 */

export const AB_SHOWN_EVENT = "kaizen:ab-shown";

/** Experiment id → version → how many markers say so (a header and a page marker can both be up). */
const shown = new Map<string, Map<string, number>>();

const announce = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AB_SHOWN_EVENT));
};

/** Registers that this page shows `version` of `experiment`; the returned function takes it away again (once). */
export function showVersion(experiment: string, version: string): () => void {
  const versions = shown.get(experiment) ?? new Map<string, number>();
  versions.set(version, (versions.get(version) ?? 0) + 1);
  shown.set(experiment, versions);
  announce();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const count = (versions.get(version) ?? 1) - 1;
    if (count > 0) versions.set(version, count);
    else versions.delete(version);
    if (versions.size === 0) shown.delete(experiment);
    announce();
  };
}

/** The versions shown now, as [experiment id, version], in a stable order. */
export function shownVersions(): [string, string][] {
  return [...shown.entries()].flatMap(([experiment, versions]) => [...versions.keys()].map((version): [string, string] => [experiment, version])).sort();
}
