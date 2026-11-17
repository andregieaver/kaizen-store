// The pure part of scripts/bundle-budget.mjs (bloat review step 1.2): every route's first scripts against a baseline, and how many
// routes' first scripts hold each of eight marker strings. Node built-ins only, nothing read from the working directory.

/** Bytes a route may grow over its baseline before the budget fails. */
export const ROOM = 15_000;

/**
 * The markers: a sentence or a name that says a part is in a route's first scripts. `only` limits the count to routes under a prefix.
 * `allowAbsent` marks a text that step 0.16 took out of every client chunk (the purposes are server-only now): the script's sanity check
 * (a marker text in no chunk at all) skips it, and the count, 0, fails the check the day the text is in a client chunk's first scripts again.
 */
export const MARKERS = [
  { key: "supabase", text: "GoTrueClient" },
  { key: "zod", text: "ZodError" },
  { key: "editor", text: "ProseMirror" },
  { key: "builderEnglish", text: "Set for {size}" },
  { key: "signInEnglish", text: "Open your authenticator app and type the six-digit code" },
  { key: "storefrontLanguage", text: "Kommer ihåg om du valde ljusa", allowAbsent: true },
  { key: "cookiePurposes", text: "Remembers whether you chose", allowAbsent: true },
  { key: "commonEnglishOnStores", text: "is switched off under Settings", only: "/s/" },
];

/** The file Next's build writes (not in its docs): an upgrade may change it, so a different shape is an error. */
export function parseStats(json) {
  const ok =
    Array.isArray(json) &&
    json.length > 0 &&
    json.every(
      (item) =>
        item &&
        typeof item.route === "string" &&
        typeof item.firstLoadUncompressedJsBytes === "number" &&
        Array.isArray(item.firstLoadChunkPaths) &&
        item.firstLoadChunkPaths.every((p) => typeof p === "string"),
    );
  if (!ok) {
    throw new Error(
      "route-bundle-stats.json is not what this script reads: expected a non-empty array of { route, firstLoadUncompressedJsBytes, firstLoadChunkPaths } " +
        "(a Next upgrade may have changed node_modules/next/dist/build/route-bundle-stats.js).",
    );
  }
  return json;
}

/**
 * route -> first-load bytes, keys sorted.
 * @returns {Record<string, number>}
 */
export function routeBytes(stats) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const item of [...stats].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0))) out[item.route] = item.firstLoadUncompressedJsBytes;
  return out;
}

/**
 * For each marker, the number of routes with at least one first-load chunk whose text holds it. textOf(chunkPath) gives a chunk's text.
 * @returns {Record<string, number>}
 */
export function markerCounts(stats, textOf) {
  const cache = new Map();
  const text = (p) => {
    let t = cache.get(p);
    if (t === undefined) {
      t = textOf(p);
      cache.set(p, t);
    }
    return t;
  };
  /** @type {Record<string, number>} */
  const out = {};
  for (const marker of MARKERS) {
    out[marker.key] = stats.filter(
      (item) => (marker.only === undefined || item.route.startsWith(marker.only)) && item.firstLoadChunkPaths.some((p) => text(p).includes(marker.text)),
    ).length;
  }
  return out;
}

const textOfKey = (key) => MARKERS.find((m) => m.key === key)?.text ?? key;

/** The markers whose text must be somewhere in the build's client chunks: the others may be in none, by design. */
export function missingMarkers(chunkTexts) {
  return MARKERS.filter((m) => !m.allowAbsent && !chunkTexts.some((text) => text.includes(m.text)));
}

/** What fails the check: a new route, a route over its room, a marker in more routes than the baseline. */
export function problems(now, baseline) {
  const list = [];
  for (const [route, bytes] of Object.entries(now.routes)) {
    const old = baseline.routes[route];
    if (old === undefined) {
      list.push(`${route}: new route at ${bytes} bytes; run node scripts/bundle-budget.mjs --write to add it`);
    } else if (bytes > old + ROOM) {
      list.push(
        `${route}: ${bytes} bytes, baseline ${old} (+${bytes - old}). Find the import that grew it (node docs/audits/bloat-review-2026-11/scripts/markers.mjs and docs/performance.md say how); if the page needs it, take it on purpose with node scripts/bundle-budget.mjs --write --accept after pnpm build, so the growth shows in the baseline's diff.`,
      );
    }
  }
  for (const [key, count] of Object.entries(now.markers)) {
    const old = baseline.markers[key];
    if (old !== undefined && count > old) list.push(`${key} (${textOfKey(key)}) is in the first scripts of ${count} routes, baseline ${old}`);
  }
  return list;
}

/** What has fallen, so the baseline should be lowered in the same change. */
export function fallen(now, baseline) {
  const list = [];
  const tail = "; run node scripts/bundle-budget.mjs --write in this change";
  for (const [route, old] of Object.entries(baseline.routes)) {
    const bytes = now.routes[route];
    if (bytes === undefined) list.push(`${route}: no longer in the build${tail}`);
    else if (bytes < old - ROOM) list.push(`${route}: ${bytes} bytes, baseline ${old} (-${old - bytes})${tail}`);
  }
  for (const [key, count] of Object.entries(now.markers)) {
    const old = baseline.markers[key];
    if (old !== undefined && count < old) list.push(`${key} (${textOfKey(key)}) is in the first scripts of ${count} routes, baseline ${old}${tail}`);
  }
  return list;
}

/**
 * The baseline to write: never above an old figure; new routes added; routes gone from the build left out.
 * @param {{ routes: Record<string, number>, markers: Record<string, number> }} now
 * @param {{ routes: Record<string, number>, markers: Record<string, number> }} baseline
 * @returns {{ routes: Record<string, number>, markers: Record<string, number> }}
 */
export function lowered(now, baseline) {
  /** @type {Record<string, number>} */
  const routes = {};
  for (const [route, bytes] of Object.entries(now.routes)) {
    const old = baseline.routes[route];
    routes[route] = old === undefined ? bytes : Math.min(bytes, old);
  }
  /** @type {Record<string, number>} */
  const markers = {};
  for (const [key, count] of Object.entries(now.markers)) {
    const old = baseline.markers[key];
    markers[key] = old === undefined ? count : Math.min(count, old);
  }
  return { routes, markers };
}
