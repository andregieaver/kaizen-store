import fs from 'node:fs';
import zlib from 'node:zlib';
import { splitChunk } from './split.mjs';
const [,, id, ...chunks] = process.argv;
for (const c of chunks) { const {mods}=splitChunk(c); for (const m of mods) if (m.ids.includes(id)) { console.log('chunk',c,'size',m.size,'gz',zlib.gzipSync(m.text).length); console.log(m.text.slice(0, Number(process.env.N||1500))); } }
