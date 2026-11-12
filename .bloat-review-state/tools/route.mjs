import fs from 'node:fs';
import zlib from 'node:zlib';
const root='/home/user/kaizen-store/.next/';
for (const route of process.argv.slice(2)) {
  const file = root+'server/app'+route+'/page_client-reference-manifest.js';
  const src = fs.readFileSync(file,'utf8'); globalThis.__RSC_MANIFEST = {}; new Function(src)();
  const key = Object.keys(globalThis.__RSC_MANIFEST)[0]; const m = globalThis.__RSC_MANIFEST[key];
  const all = new Set();
  for (const [k,v] of Object.entries(m.entryJSFiles||{})) { if (/global-error|global-not-found|builtin\/not-found|\/error$|\/not-found$/.test(k)) continue; for (const c of v) all.add(c); }
  let tr=0,tg=0; for (const c of all) { const b=fs.readFileSync(root+c); tr+=b.length; tg+=zlib.gzipSync(b).length; }
  const mods = Object.keys(m.clientModules).map(k=>k.replace(/^\[project\]\//,'').replace(/ <.*$/,'').replace(/ \[.*$/,'')).filter(k=>!k.includes('node_modules'));
  console.log(route.padEnd(52), 'entry chunks', String(all.size).padStart(2), 'raw', String(tr).padStart(7), 'gz', String(tg).padStart(6), 'client modules', [...new Set(mods)].length);
  if (process.env.LIST) console.log('   ', [...new Set(mods)].sort().map(x=>x.replace('src/components/','')).join(' '));
}
