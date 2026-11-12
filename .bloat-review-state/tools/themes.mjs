import fs from 'node:fs';
const rows = fs.readFileSync('loc.tsv','utf8').trim().split('\n').map(l=>{const [n,p]=l.split('\t'); return {n:+n,p};}).filter(r=>/\.(ts|tsx)$/.test(r.p) && r.p.startsWith('src/'));
const G = {
 'theme settings (D60: lib/theme.ts, server/themes.ts, store-theme)': /(src\/lib\/theme\.ts|src\/server\/themes\.ts|store-theme\.|theme-elements|theme-highlights|theme-highlight-words|theme-sections|section-styles|theme-kit)/,
 'themes library/installs/updates (D241-D246: design-presets, theme-installs, theme-update, theme-check, theme-detach, try)': /(design-presets?|design-variations|theme-installs|theme-update|theme-check|theme-detach|theme-changes|theme-preview|theme-host|theme-admin-paths|design-cards|look-versions)/,
 'theme store + prices + submissions (D247, D285, D286)': /(theme-store|theme-prices|theme-submissions|theme-page-parts|theme-purchases)/,
 'theme shots (screenshots job)': /(theme-shot|theme-shoot)/,
 'theme schedules (D340)': /theme-schedules/,
 'signature + launch themes (D267.., code-defined themes)': /(signature|launch-themes)/,
 'store starters / demo stores / content packs / demo content / home takes / pack pictures': /(store-starters?|demo-stores?|demo-content|content-packs?|content-pack-pages|pack-designs|pack-pictures|home-takes|starter)/,
 'page templates (D125) + page layouts (D127)': /(\/templates?[-.\/]|template-content|template-paths|page-layout)/,
 'platform theme installs (D251 twin)': /platform-theme/,
};
for (const [name,re] of Object.entries(G)){
  let code=0,test=0,f=0,tf=0; const big=[];
  for(const r of rows){ const p=r.p.toLowerCase(); if(!re.test(p)) continue; if(/\.test\.tsx?$/.test(p)){test+=r.n;tf++;} else {code+=r.n;f++; big.push(r);} }
  big.sort((a,b)=>b.n-a.n);
  console.log(`${name}\n   code ${code} in ${f} files; tests ${test} in ${tf} files; biggest: ${big.slice(0,4).map(b=>b.p.replace('src/','')+':'+b.n).join(', ')}`);
}
