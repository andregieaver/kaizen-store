// Builds the WordPress plugin's zip into public/downloads/ (D169). Run it after changing anything in wordpress-plugin/kaizen-store/ and commit
// the result: a unit test fails while the zip and the files disagree.
//
//   node scripts/build-wordpress-plugin.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildPluginZip, PLUGIN_ZIP, pluginFiles } from "./wordpress-plugin-zip.mjs";

const zip = await buildPluginZip();
await mkdir(path.dirname(PLUGIN_ZIP), { recursive: true });
await writeFile(PLUGIN_ZIP, zip);
console.log(`wrote ${path.relative(process.cwd(), PLUGIN_ZIP)}: ${(await pluginFiles()).length} files, ${zip.length} bytes`);
