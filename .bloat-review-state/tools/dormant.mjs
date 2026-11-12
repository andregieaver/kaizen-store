import fs from 'node:fs';
const rows = fs.readFileSync('loc.tsv','utf8').trim().split('\n').map(l=>{const [n,p]=l.split('\t'); return {n:+n,p};}).filter(r=>/\.(ts|tsx)$/.test(r.p));
const D = {
  'email marketing': /(broadcast|marketing-subscribers|marketing-consent|marketing-email|\/subscribers\/|segment|\/automations\/|\/automations?\.|automation-kinds|automation-starters|components\/admin\/automations\/)/,
  'sms': /(\/sms|sms\.|sms-|text-messages)/,
  'creators': /creator/,
  'gift cards': /gift-card/,
  'product reviews': /(\/reviews?[-.\/]|review-(import|picture|requests|status|view|facts)|reviews-admin)/,
  'fiken': /fiken/,
  'workflows': /workflow/,
  'order rules': /(order-rules|settings\/automation\/|components\/admin\/automation\/)/,
  'checkout rules': /checkout-rules/,
  'webhook endpoints': /(webhook-endpoints|webhook-signature|webhook-topics|platform-endpoints|endpoint-emails|app-endpoints)/,
  'admin api': /(admin-api|api-tokens|api-idempotency|api-uploads|api-carts|api-contract|openapi|platform-api)/,
  'storefront api': /(storefront-api|storefront-route|storefront-tokens)/,
  'oauth/mcp/apps': /(oauth|store-mcp|mcp-catalogue|custom-apps|developer-apps|\/apps\.|\/mcp\/|\/apps\/)/,
  'ebay': /(ebay|marketplace)/,
  'drop shipping etc': /(supplier|drop-shipping|purchase-order|stock-transfer|stock-documents)/,
  'recommendations': /recommend/,
  'search merchandising': /(search-rules|search-synonyms)/,
  'price lists etc': /(price-list|price-break|company-location|payment-terms)/,
  'shipping methods etc': /(shipping-method|pickup|local-delivery|shipping-admin|shipping-limits)/,
  'carriers': /(bring|postnord|porterbuddy|helthjem|instabox|dhl|\/ups\.|sendcloud|nshift|carrier)/,
  'autopilot': /(autopilot|follow-up|saved-skills|assistant-skills)/,
  'ads/feeds': /(ad-connections|ad-conversions|ad-payloads|ad-signals|\/ads\/|\/feeds?[-.\/]|feed-settings|platform-ad-)/,
  'staging/schedules': /(staging|page-schedules|theme-schedules|preview-links|preview-token|schedule-tools)/,
  'store copy': /store-copy/,
  'domains': /(domain|dns-|registrar|zone-file|vercel-dns)/,
  'mollie': /(mollie)/,
  'passports/claims/producer': /(product-passport|passport|green-claims|producer)/,
  'status page': /(\/status[-.\/])/,
  'instagram': /instagram/,
  'bonus': /bonus/,
  'referrals/affiliates': /(referral|affiliate)/,
};
const seen=new Map(); let code=0,test=0; const per={};
for(const r of rows){ const p=r.p.toLowerCase(); for(const [k,re] of Object.entries(D)){ if(re.test(p)){ if(!seen.has(r.p)){ seen.set(r.p,k); const isTest=/\.test\.tsx?$/.test(p)||p.startsWith('e2e/'); per[k]??={code:0,test:0,files:0}; if(isTest){test+=r.n; per[k].test+=r.n;} else {code+=r.n; per[k].code+=r.n; per[k].files++;} } break; } } }
console.log('union code lines',code,'test lines',test,'files',seen.size);
let allCode=0, allTest=0; for(const r of rows){ if(!r.p.startsWith('src/')) continue; if(/\.test\.tsx?$/.test(r.p)) allTest+=r.n; else allCode+=r.n; }
console.log('all src code',allCode,'all src tests',allTest, 'share', (code/allCode*100).toFixed(1)+'%');
console.log(Object.entries(per).map(([k,v])=>`${k}:${v.code}/${v.test}`).join(' | '));
