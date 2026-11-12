import fs from 'node:fs';
import zlib from 'node:zlib';
const root='/home/user/kaizen-store/.next';
const pages = process.argv.slice(2);
const seenAll = {};
for (const f of pages) {
  const html = fs.readFileSync(f,'utf8');
  const srcs = [...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)].filter(m=>!/nomodule/i.test(m[1]+m[3])).map(m=>m[2]);
  const pre = [...html.matchAll(/<link rel="preload"[^>]*href="([^"]+\.js)"[^>]*>/g)].map(m=>m[1]);
  let tr=0,tg=0, pr=0,pg=0;
  for (const s of srcs) { const b=fs.readFileSync(root+s.replace(/^\/_next/,'')); tr+=b.length; tg+=zlib.gzipSync(b).length; }
  for (const s of pre) { if (srcs.includes(s)) continue; const b=fs.readFileSync(root+s.replace(/^\/_next/,'')); pr+=b.length; pg+=zlib.gzipSync(b).length; }
  let rsc=0, rscgz=0; try { const r=fs.readFileSync(f.replace(/\.html$/,'.segments/_full.segment.rsc')); rsc=r.length; rscgz=zlib.gzipSync(r).length; } catch {}
  console.log(f.padEnd(34), 'html', String(html.length).padStart(7), 'gz', String(zlib.gzipSync(html).length).padStart(6), '| scripts', String(srcs.length).padStart(2), 'raw', String(tr).padStart(7), 'gz', String(tg).padStart(6), '| preloaded-lazy', pre.filter(s=>!srcs.includes(s)).length, 'raw', pr, 'gz', pg, '| rsc', rsc, 'gz', rscgz);
  seenAll[f]=new Set([...srcs,...pre]);
}
