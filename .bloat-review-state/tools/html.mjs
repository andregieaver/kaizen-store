import fs from 'node:fs';
import zlib from 'node:zlib';
const f = process.argv[2];
const html = fs.readFileSync(f,'utf8');
const gz = zlib.gzipSync(html).length;
console.log('FILE', f, 'bytes', html.length, 'gz', gz);
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
let inlineTotal=0, flight=0, ext=[];
const inl=[];
for (const s of scripts) {
  const src = /src="([^"]+)"/.exec(s[1]);
  if (src) ext.push(src[1] + (/async/.test(s[1])?' async':'') + (/nomodule/i.test(s[1])?' nomodule':''));
  else { inlineTotal += s[2].length; if (s[2].includes('__next_f')) flight += s[2].length; else inl.push(s[2].slice(0,160).replace(/\n/g,' ')+' …('+s[2].length+')'); }
}
console.log('external scripts', ext.length);
const root='/home/user/kaizen-store/.next';
let tr=0,tg=0;
for (const e of ext) { const p = e.split(' ')[0].replace(/^\/_next/,'').split('?')[0]; try { const b=fs.readFileSync(root+p); const g=zlib.gzipSync(b).length; if(!e.includes('nomodule')){tr+=b.length;tg+=g;} console.log('  ',e,b.length,g);} catch(err){console.log('  ',e,'?');} }
console.log('external total raw', tr, 'gz', tg);
console.log('inline script bytes', inlineTotal, 'of which flight', flight, 'share', (flight/html.length*100).toFixed(1)+'%');
console.log('other inline scripts:'); for (const i of inl) console.log('   ', i);
const styles=[...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)];
let st=0; for (const s of styles) { st+=s[2].length; console.log('style', s[1].slice(0,80), s[2].length); }
console.log('style total', st);
const links=[...html.matchAll(/<link\b[^>]*>/g)].map(l=>l[0]);
for (const l of links) if (/stylesheet|preload|preconnect|modulepreload|dns-prefetch/.test(l)) console.log('link', l.slice(0,260));
const tpl = [...html.matchAll(/<template\b[^>]*>/g)].length;
console.log('templates', tpl, 'imgs', [...html.matchAll(/<img\b/g)].length);
