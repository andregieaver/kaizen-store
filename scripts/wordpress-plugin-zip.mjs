// The WordPress plugin as an installable zip (D169, `docs/wordpress-plugin.md`): the files of `wordpress-plugin/kaizen-store/` under one
// folder `kaizen-store/`, in a fixed order with fixed dates, so the same files always give the same bytes and a test can tell whether the
// zip in `public/downloads/` is the plugin as it is now. No dependency: a zip is a few headers around deflated files.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

export const PLUGIN_DIR = path.join(import.meta.dirname, "..", "wordpress-plugin", "kaizen-store");
export const PLUGIN_ZIP = path.join(import.meta.dirname, "..", "public", "downloads", "kaizen-store-wordpress.zip");
/** Every version as it was released, one zip each (`kaizen-store-wordpress-{version}.zip`), offered on the docs' WordPress page. */
export const RELEASES_DIR = path.join(import.meta.dirname, "..", "public", "downloads", "wordpress");
export const releaseZip = (version) => path.join(RELEASES_DIR, `kaizen-store-wordpress-${version}.zip`);

/** The plugin's version as its main file's header says it (`Version: 1.2.1`). */
export async function pluginVersion(dir = PLUGIN_DIR) {
  const header = await readFile(path.join(dir, "kaizen-store.php"), "utf8");
  const version = /^\s*\*\s*Version:\s*(\S+)/m.exec(header)?.[1];
  if (!version) throw new Error("kaizen-store.php has no Version line.");
  return version;
}

/** One file of a zip by its path inside, read from the central directory and inflated; null when the zip has no such file. */
export function readZipEntry(zip, wanted) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Not a zip: no end of central directory.");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("Not a zip: a broken central directory.");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    if (name === wanted) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}
export const ROOT = "kaizen-store";

// 1 January 1980, 00:00: the zip format's earliest date.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** Every file of the plugin, as a path inside the folder with `/`, sorted. Nothing hidden and nothing that is only for developers. */
export async function pluginFiles(dir = PLUGIN_DIR) {
  const out = [];
  async function walk(current, prefix) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith(".")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), relative);
      else if (entry.isFile()) out.push(relative);
    }
  }
  await walk(dir, "");
  return out.sort();
}

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}
function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return b;
}

/** The zip's bytes. */
export async function buildPluginZip(dir = PLUGIN_DIR) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of await pluginFiles(dir)) {
    const data = await readFile(path.join(dir, file));
    const name = Buffer.from(`${ROOT}/${file}`, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const common = [u16(20), u16(0x0800), u16(8), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(deflated.length), u32(data.length), u16(name.length), u16(0)];
    const local = Buffer.concat([u32(0x04034b50), ...common, name, deflated]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16((3 << 8) | 20),
      ...common,
      u16(0), // comment length
      u16(0), // disk number
      u16(0), // internal attributes
      u32((0o100644 << 16) >>> 0), // a regular file, rw-r--r--
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(centralBytes.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, centralBytes, end]);
}
