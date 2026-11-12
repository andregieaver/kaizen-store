import fs from 'node:fs';
import zlib from 'node:zlib';
const file = process.argv[2];
const src = fs.readFileSync(file,'utf8');
globalThis.__RSC_MANIFEST = {};
new Function(src)();
const key = Object.keys(globalThis.__RSC_MANIFEST)[0];
const m = globalThis.__RSC_MANIFEST[key];
const size = (c) => { try { const b = fs.readFileSync('.'+ (c.startsWith('/_next')? c.slice(6): '/'+c)); return [b.length, zlib.gzipSync(b).length]; } catch(e) { return [0,0]; } };
const all = new Set();
for (const [k,v] of Object.entries(m.entryJSFiles||{})) { for (const c of v) all.add(c); }
console.log('ENTRY FILES union', all.size);
let tr=0,tg=0;
for (const c of all) { const [r,g]=size(c); tr+=r; tg+=g; console.log('  ', c, r, g); }
console.log('entry total raw', tr, 'gz', tg);
// client modules
const mods = {};
for (const [k,v] of Object.entries(m.clientModules)) {
  const name = k.replace(/^\[project\]\//,'').replace(/ <.*$/,'').replace(/ \[.*$/,'');
  mods[name] = v.chunks;
}
const names = Object.keys(mods).sort();
for (const n of names) { if (n.includes('node_modules')) continue; console.log(n, '=>', mods[n].filter(c=>!all.has(c) && !all.has('static/chunks/'+c.split('/').pop())).length, '/', mods[n].length); }
