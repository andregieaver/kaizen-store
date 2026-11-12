import fs from 'node:fs';
const dir = process.argv[2];
const a = JSON.parse(fs.readFileSync(dir + '/' + process.argv[3] + '.json', 'utf8'));
const b = JSON.parse(fs.readFileSync(dir + '/' + process.argv[4] + '.json', 'utf8'));
console.log('keys', Object.keys(a));
const bset = new Set(b.server.map((x) => x[0]));
const diff = a.server.filter((x) => !bset.has(x[0]));
const group = (name) => {
  if (name.startsWith('~/')) {
    const p = name.slice(2).split('/');
    return 'pkg:' + (p[0].startsWith('@') ? p[0] + '/' + p[1] : p[0]);
  }
  if (name.startsWith('src/')) {
    const p = name.split('/');
    if (p[1] === 'lib' && p.length > 3) return 'src/lib/' + p[2];
    if (p[1] === 'server' && p.length > 3) return 'src/server/' + p[2];
    if (p[1] === 'app') return 'src/app/' + (p[2] || '');
    if (p[1] === 'data') return 'src/data/' + p[2];
    if (p[1] === 'components' && p.length > 3) return 'src/components/' + p[2];
    return p[0] + '/' + p[1];
  }
  return name.split('/')[0];
};
const g = new Map();
for (const [n, s] of diff) {
  const k = group(n);
  const e = g.get(k) || { n: 0, s: 0 };
  e.n++; e.s += s; g.set(k, e);
}
const tot = diff.reduce((t, x) => t + x[1], 0);
console.log('a modules', a.server.length, 'bytes', a.server.reduce((t, x) => t + x[1], 0));
console.log('b modules', b.server.length, 'bytes', b.server.reduce((t, x) => t + x[1], 0));
console.log('diff modules', diff.length, 'bytes', tot);
for (const [k, e] of [...g.entries()].sort((x, y) => y[1].s - x[1].s)) console.log(String(Math.round(e.s / 1024)).padStart(6), 'KB', String(e.n).padStart(5), k);
