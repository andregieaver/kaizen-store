import fs from 'node:fs';
import zlib from 'node:zlib';
const f = process.argv[2];
const html = fs.readFileSync(f,'utf8');
let payload = '';
for (const m of html.matchAll(/<script[^>]*>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
  let arr; try { arr = JSON.parse(m[1]); } catch { continue; }
  if (arr[0] === 1) payload += arr[1];
}
console.log('payload chars', payload.length, 'bytes', Buffer.byteLength(payload), 'gzip', zlib.gzipSync(payload).length);
// split rows: id:tag... Row framing: "hex:" then either T<len>, (text row) or JSON until newline
const rows = [];
let i = 0;
const buf = Buffer.from(payload, 'utf8');
while (i < buf.length) {
  let j = buf.indexOf(0x3a, i); if (j < 0) break;
  const id = buf.slice(i, j).toString();
  const tag = String.fromCharCode(buf[j+1]);
  if (tag === 'T') {
    const k = buf.indexOf(0x2c, j); const len = parseInt(buf.slice(j+2, k).toString(), 16);
    rows.push({ id, tag: 'T', body: buf.slice(k+1, k+1+len).toString(), size: k+1+len - i });
    i = k + 1 + len;
  } else {
    let k = buf.indexOf(0x0a, j); if (k < 0) k = buf.length;
    rows.push({ id, tag, body: buf.slice(j+1, k).toString(), size: k + 1 - i });
    i = k + 1;
  }
}
console.log('rows', rows.length);
rows.sort((a,b)=>b.size-a.size);
for (const r of rows.slice(0, 14)) console.log(r.id.padStart(4), String(r.size).padStart(7), r.body.slice(0,150).replace(/\n/g,' '));
// duplicates: normalise row references $L.. / $.. ids
const norm = (s) => s.replace(/\$(L|@|F|Q|W|K|B)?[0-9a-f]+\b/g, '$$$1#');
const seen = new Map(); let dup = 0, dupExact = 0; const exact = new Map();
for (const r of rows) { const k = norm(r.body); if (seen.has(k) && r.size > 200) { dup += r.size; if (process.env.V) console.log('dup', r.id, 'of', seen.get(k), r.size, r.body.slice(0,80)); } else seen.set(k, r.id); if (exact.has(r.body) && r.size>200) dupExact += r.size; else exact.set(r.body, r.id); }
console.log('duplicate bytes (normalised refs)', dup, 'exact', dupExact);
if (process.env.OUT) { // payload without duplicates gz
  const s2 = new Set();
  const order = rows.slice(); let out='';
  for (const r of order) { const k = norm(r.body); if (s2.has(k) && r.size>200) continue; s2.add(k); out += r.id+':'+r.body+'\n'; }
  console.log('without dups bytes', Buffer.byteLength(out), 'gzip', zlib.gzipSync(out).length);
}
