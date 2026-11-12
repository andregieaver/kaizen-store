import fs from 'node:fs';
const src=fs.readFileSync('/home/user/kaizen-store/src/lib/owner-tools.ts','utf8');
const re=/tool\(\s*"([a-z_0-9]+)",\s*((?:"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)(?:\s*\+\s*(?:"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`))*)/g;
let m, n=0, bytes=0; const sizes=[];
while((m=re.exec(src))){ n++; const len=m[2].length; bytes+=len; sizes.push([len,m[1]]); }
sizes.sort((a,b)=>b[0]-a[0]);
console.log('tools with parsed description',n,'description chars total',bytes,'mean',Math.round(bytes/n));
console.log('top', sizes.slice(0,8).map(s=>s.join(':')).join(' '));
console.log('file bytes', src.length);
