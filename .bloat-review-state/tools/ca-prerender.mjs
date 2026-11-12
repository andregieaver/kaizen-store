import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('/home/user/kaizen-store/.next/prerender-manifest.json','utf8'));
const routes = Object.keys(m.routes);
const dyn = Object.keys(m.dynamicRoutes);
console.log('version', m.version, 'routes', routes.length, 'dynamicRoutes', dyn.length);
const bucket = (r) => r.startsWith('/admin') ? 'admin' : r.startsWith('/s/') ? 'store' : r.startsWith('/docs') || r.startsWith('/no/docs') ? 'docs' : r.startsWith('/themes') || r.startsWith('/no/themes') ? 'themes' : r.startsWith('/api') ? 'api' : 'site';
const c = {}; for (const r of routes) c[bucket(r)] = (c[bucket(r)]||0)+1; console.log('routes by area', c);
const d = {}; for (const r of dyn) d[bucket(r)] = (d[bucket(r)]||0)+1; console.log('dynamicRoutes by area', d);
// revalidate distribution
const rv = {}; for (const r of routes) { const k = bucket(r)+':'+m.routes[r].initialRevalidateSeconds+'/'+m.routes[r].initialExpireSeconds; rv[k]=(rv[k]||0)+1; } console.log(rv);
// renderingMode / experimentalPPR
const pp = {}; for (const r of routes) { const k = JSON.stringify([m.routes[r].renderingMode, m.routes[r].experimentalPPR]); pp[k]=(pp[k]||0)+1;} console.log(pp);
console.log(JSON.stringify(m.routes['/s/demo/no'], null, 1));
console.log(JSON.stringify(m.dynamicRoutes['/s/[store]/[market]'], null, 1));
console.log(JSON.stringify(m.dynamicRoutes['/s/[store]/[market]/p/[handle]'], null, 1));
const store = routes.filter(r=>r.startsWith('/s/'));
console.log('store routes', store.length);
const shapes = {}; for (const r of store) { const s = r.replace(/^\/s\/demo\/(no|dk|se)/,'/s/demo/M'); shapes[s]=(shapes[s]||0)+1; }
console.log(Object.keys(shapes).length, 'distinct store shapes');
console.log(store.filter(r => /account|\[|token|order|checkout|cart|wishlist/.test(r)).length, 'store routes that are session or token pages');
