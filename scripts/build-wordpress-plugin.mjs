// Builds the WordPress plugin's zip into public/downloads/ (D169), and the same bytes as this version's own file in public/downloads/wordpress/,
// which the docs' WordPress page offers beside the earlier versions. Run it after changing anything in wordpress-plugin/kaizen-store/ and
// commit the result: a unit test fails while the zip and the files disagree. A released version's file is never rebuilt: raise the version
// first (kaizen-store.php, readme.txt, src/lib/wordpress-plugin.ts with WORDPRESS_PLUGIN_RELEASES) and add it to the docs' download table.
//
//   node scripts/build-wordpress-plugin.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildPluginZip, PLUGIN_ZIP, pluginFiles, pluginVersion, releaseZip } from "./wordpress-plugin-zip.mjs";

const zip = await buildPluginZip();
await mkdir(path.dirname(PLUGIN_ZIP), { recursive: true });
await writeFile(PLUGIN_ZIP, zip);
const release = releaseZip(await pluginVersion());
await mkdir(path.dirname(release), { recursive: true });
await writeFile(release, zip);
console.log(`wrote ${path.relative(process.cwd(), PLUGIN_ZIP)} and ${path.relative(process.cwd(), release)}: ${(await pluginFiles()).length} files, ${zip.length} bytes`);
