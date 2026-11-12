import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const root = '/home/user/kaizen-store';
const out = execSync(`rg -n "^\\s*['\\"]use cache(: [a-z]+)?['\\"]" src --glob '!*.test.ts' --glob '!*.test.tsx'`, { cwd: root }).toString().trim().split('\n');
const rows = [];
for (const line of out) {
  const m = line.match(/^([^:]+):(\d+):(.*)$/);
  const file = m[1], ln = +m[2];
  const src = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
  // find function signature above
  let sig = '';
  for (let i = ln - 2; i >= Math.max(0, ln - 12); i--) {
    if (/function |=>\s*\{|async /.test(src[i])) { sig = src[i].trim(); break; }
  }
  // look ahead up to 14 lines for cacheLife and cacheTag
  let life = '', tags = [];
  for (let i = ln; i < Math.min(src.length, ln + 14); i++) {
    const l = src[i];
    const a = l.match(/cacheLife\(([^)]*)\)/); if (a && !life) life = a[1];
    const b = l.match(/cacheTag\((.*)\)/); if (b) tags.push(b[1]);
    if (/^\}/.test(l)) break;
  }
  rows.push({ file, ln, sig: sig.slice(0, 150), life: life || '(default)', tags: tags.join(' | ') });
}
for (const r of rows) console.log(`${r.file}:${r.ln}\t${r.life}\t${r.tags}\t${r.sig}`);
console.log(rows.length);
