import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CARD_SIZE,
  SHARE_SIZE,
  SHOTS_FOLDER,
  missingShots,
  picturesOf,
  readShotParts,
  readShotPictures,
  shotFolder,
  shotKey,
  shotPaths,
  supersededShots,
  topCrop,
  wantedShots,
  type ShotTheme,
  type StoredShot,
  type WantedShot,
} from "./theme-shots";

/** The photographs of themes' looks (`docs/theme-showcase-phase-2.md` step 1): what is wanted, set aside, cut and read back. */

const T = "00000000-0000-4000-8000-000000000001";
const FASHION = "00000000-0000-4000-8000-0000000000f1";
const FASHION_COPY = "00000000-0000-4000-8000-0000000000c1";
const STANDARD = "00000000-0000-4000-8000-0000000000a1";
const storeOf = (starterId: string | null) => (starterId === null ? STANDARD : starterId === FASHION ? FASHION_COPY : null);
const theme = (version: number, looks: ShotTheme["looks"] = [{ variation: null, starterId: FASHION }, { variation: "sand", starterId: null }]): ShotTheme => ({ id: T, version, looks });
const stored = (shot: WantedShot, status: StoredShot["status"], id = shotKey(shot)): StoredShot => ({ ...shot, id, status });

describe("what is photographed", () => {
  it("is each look of a theme's latest version, on the store its showcase draws, at a computer's and a phone's width, and the theme's highlights from its own look", () => {
    const wanted = wantedShots([theme(3)], storeOf);
    expect(wanted.map((w) => [w.variation, w.showcaseStoreId, w.kind, w.version])).toEqual([
      [null, FASHION_COPY, "computer", 3],
      [null, FASHION_COPY, "phone", 3],
      [null, FASHION_COPY, "highlights", 3],
      ["sand", STANDARD, "computer", 3],
      ["sand", STANDARD, "phone", 3],
    ]);
  });

  it("leaves out a look whose showcase's store cannot be found", () => {
    expect(wantedShots([theme(1, [{ variation: null, starterId: "00000000-0000-4000-8000-0000000000ee" }])], storeOf)).toEqual([]);
  });

  it("asks only for what is not stored yet", () => {
    const wanted = wantedShots([theme(3)], storeOf);
    expect(missingShots([stored(wanted[0], "done")], wanted)).toEqual(wanted.slice(1));
  });
});

describe("what is set aside", () => {
  const v2 = wantedShots([theme(2)], storeOf);
  const v3 = wantedShots([theme(3)], storeOf);

  it("is a unit not done that is no longer wanted", () => {
    expect(supersededShots([stored(v2[0], "waiting"), stored(v2[1], "failed"), stored(v2[2], "running")], v3)).toEqual([shotKey(v2[0]), shotKey(v2[1]), shotKey(v2[2])]);
  });

  it("keeps a done set of an older version until its look has a done set of the version wanted", () => {
    const older = stored(v2[0], "done");
    expect(supersededShots([older, stored(v3[0], "waiting")], v3)).toEqual([]);
    expect(supersededShots([older, stored(v3[0], "done")], v3)).toEqual([shotKey(v2[0])]);
  });

  it("sets aside a done set whose look is not wanted at all: a preset taken out, a theme no longer published", () => {
    const sandShot = v3.find((w) => w.variation === "sand" && w.kind === "computer")!;
    const sand = stored(sandShot, "done");
    expect(supersededShots([sand], wantedShots([theme(4, [{ variation: null, starterId: FASHION }])], storeOf))).toEqual([shotKey(sandShot)]);
    expect(supersededShots([sand], [])).toEqual([shotKey(sandShot)]);
  });

  it("never touches what is wanted or already set aside", () => {
    expect(supersededShots([stored(v3[0], "waiting"), stored(v3[1], "done"), stored(v2[1], "superseded")], v3)).toEqual([]);
  });
});

describe("the pictures cut from a photograph", () => {
  it("cut the card (4:3) and the share image (1200:630) from the top, never past the page", () => {
    expect(topCrop(1440, 6000, CARD_SIZE.width / CARD_SIZE.height)).toEqual({ left: 0, top: 0, width: 1440, height: 1080 });
    expect(topCrop(1440, 6000, SHARE_SIZE.width / SHARE_SIZE.height)).toEqual({ left: 0, top: 0, width: 1440, height: 756 });
    expect(topCrop(1440, 500, CARD_SIZE.width / CARD_SIZE.height)).toEqual({ left: 0, top: 0, width: 1440, height: 500 });
  });

  it("are a card, a share image and a close photograph of the product only from a computer, and the three highlights from their unit", () => {
    expect(picturesOf("computer")).toEqual(["full", "screen", "card", "share", "detail"]);
    expect(picturesOf("phone")).toEqual(["full", "screen"]);
    expect(picturesOf("highlights")).toEqual(["devices", "collage", "closeup"]);
  });

  it("are kept under the platform's own folder, per theme and unit", () => {
    expect(shotFolder(T, "u1")).toBe(`${SHOTS_FOLDER}/${T}/u1`);
  });
});

describe("a stored unit read back", () => {
  const file = { path: `${SHOTS_FOLDER}/${T}/u1/computer-card.webp`, url: "https://x.supabase.co/storage/v1/object/public/product-media/a.webp", width: 800, height: 600, bytes: 31000 };

  it("keeps only well-formed files under the shots' folder", () => {
    const read = readShotPictures({ card: file, full: { ...file, path: "elsewhere/a.webp" }, share: { ...file, url: "javascript:alert(1)" }, screen: { ...file, width: 0 }, other: file });
    expect(read).toEqual({ card: file });
    expect(readShotPictures(null)).toEqual({});
    expect(shotPaths({ card: file, screen: { ...file, path: `${SHOTS_FOLDER}/b.webp` } })).toEqual([file.path, `${SHOTS_FOLDER}/b.webp`]);
  });

  it("reads the page's parts, leaving out what cannot be read", () => {
    expect(readShotParts({ length: 4000, header: { top: 0, height: 120 }, rows: [{ top: 120, height: 600 }, { top: "x" }], product: null, footer: { top: 3600, height: 400 } })).toEqual({
      length: 4000,
      header: { top: 0, height: 120 },
      rows: [{ top: 120, height: 600 }],
      product: null,
      footer: { top: 3600, height: 400 },
    });
    expect(readShotParts({ length: 0 })).toBeNull();
    expect(readShotParts("nope")).toBeNull();
  });
});

/** Every source file under `dir`, as a path from the repository's root. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path.relative(process.cwd(), full)] : [];
  });
}

describe("Chromium stays in the theme shots' own route", () => {
  const files = sources(path.join(process.cwd(), "src"));
  const importing = (pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(file, "utf8")));

  it("is loaded only by the runner, which only the job's route imports", () => {
    expect(importing(/from "(\.\/|@\/server\/)theme-shot-runner"/)).toEqual(["src/app/api/cron/theme-shots/route.ts"]);
    expect(importing(/from "(\.\/|@\/server\/)browser"/).filter((file) => /theme-shot/.test(file))).toEqual(["src/server/theme-shot-runner.ts"]);
  });
});
