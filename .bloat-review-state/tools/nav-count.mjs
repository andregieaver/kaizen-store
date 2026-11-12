import fs from 'node:fs';
const src = fs.readFileSync('/home/user/kaizen-store/src/lib/store-nav.ts','utf8');
// parse sections crudely
const lines = src.split('\n');
let section=null; const out={};
const CUST = '["shop","sales"]';
for (const l of lines){
  const k = l.match(/^\s+key: "(\w+)"/); if(k){section=k[1]; out[section]={items:[],feature:null}; continue;}
  const sf = l.match(/^    feature: (.+),$/); if(sf && section){ out[section].feature = sf[1]; }
  const m = l.match(/item\("([^"]+)", "([^"]+)", .*\{(.*)\}\)/);
  if(m && section){
    const extra=m[3];
    const feat = (extra.match(/feature: (\[[^\]]+\]|"[^"]+"|CUSTOMERS_FEATURE)/)||[])[1]||null;
    out[section].items.push({path:m[1],label:m[2],basic:/basic: true/.test(extra),feature:feat,customer:/customer: true/.test(extra)});
  }
}
let total=0,basic=0,noFeature=0,shopOnly=0,shopOnlyBasic=0,gated=0;
const featureCounts={};
const startOf={orders:'/orders',products:'/products',customers:'/customers',marketing:'/campaigns',analytics:'/analytics',website:'/website',bookings:'/bookings',support:'/support',settings:'/settings'};
const onWith=(feat,set)=>{ if(!feat) return true; if(feat==='CUSTOMERS_FEATURE') return set.has('shop')||set.has('sales'); const ids=[...feat.matchAll(/"(\w+)"/g)].map(x=>x[1]); return ids.some(i=>set.has(i)); };
const shop=new Set(['shop']);
for(const [s,v] of Object.entries(out)){
  let st=0,sb=0,sso=0,ssob=0;
  for(const i of v.items){
    total++; st++;
    const isBasic = i.basic || i.path===startOf[s];
    if(isBasic){basic++; sb++;}
    if(!i.feature) noFeature++; else { gated++; featureCounts[i.feature]=(featureCounts[i.feature]||0)+1; }
    const secOn = onWith(v.feature, shop);
    if(secOn && onWith(i.feature,shop)){shopOnly++; sso++; if(isBasic){shopOnlyBasic++; ssob++;}}
  }
  console.log(s.padEnd(10),'items',st,'basic',sb,'| shop-only store: advanced',sso,'basic',ssob,'| section feature',v.feature);
}
console.log({total,basic,noFeature,gated,shopOnly,shopOnlyBasic});
console.log(featureCounts);
