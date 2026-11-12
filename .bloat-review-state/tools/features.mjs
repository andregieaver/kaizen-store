import fs from 'node:fs';
const rows = fs.readFileSync('loc.tsv','utf8').trim().split('\n').map(l=>{const [n,p]=l.split('\t'); return {n:+n,p};}).filter(r=>/\.(ts|tsx)$/.test(r.p));
// feature -> regex on path
const F = {
  'broadcasts+subscribers+segments+automations(email)': /(broadcast|marketing-subscribers|marketing-consent|marketing-email|marketing-words|\/subscribers\/|segment|\/automations\/|automations?\.|automation-kinds|automation-starters|automations-|email-opt|components\/admin\/automations\/)/,
  'sms': /(\/sms|sms\.|sms-|text-messages)/,
  'bonus': /bonus/,
  'referrals+affiliates': /(referral|affiliate)/,
  'creators': /creator/,
  'gift-cards': /gift-card/,
  'product-reviews': /(\/reviews?[-.\/]|review-(import|picture|requests|status|view|facts)|reviews-admin)/,
  'deals+leads+activities+pipedrive+filed-email+timeline': /(\/deals?[-.\/]|deal-|\/leads?[-.\/]|\/activities[-.\/]|pipedrive|filed-email|email-filing|customer-timeline|sales-reports|sales-view)/,
  'own-books(ledger,saft,vat-return,bank,budget,year-end,inbox,costs,watch,clients)': /(ledger|saft|vat-return|bank-statement|bank-invoices|bank-own-lines|recurring-costs|books-|\/books\/|budget|year-end|turnover-watch|platform-books|supplier-invoices|bill-reading|receipt-reading|purchases\.)/,
  'tripletex': /tripletex/,
  'fiken': /fiken/,
  'einvoice/peppol': /(einvoice|peppol|access-point)/,
  'workflows': /workflow/,
  'order-rules(automation)': /(order-rules|settings\/automation\/|components\/admin\/automation\/)/,
  'checkout-rules': /checkout-rules/,
  'webhook-endpoints': /(webhook-endpoints|webhook-signature|webhook-topics|platform-endpoints|endpoint-emails|app-endpoints)/,
  'admin-api+tokens+openapi': /(admin-api|api-tokens|api-idempotency|api-uploads|api-carts|api-contract|openapi|platform-api)/,
  'storefront-api': /(storefront-api|storefront-route|storefront-tokens)/,
  'oauth+mcp+custom/developer apps': /(oauth|store-mcp|mcp-catalogue|custom-apps|developer-apps|\/apps\.|\/mcp\/|\/apps\/)/,
  'shopping-agents+ucp': /(shopping-agent|ucp)/,
  'ebay/marketplace': /(ebay|marketplace)/,
  'drop-shipping+suppliers+purchase-orders+transfers': /(supplier|drop-shipping|purchase-order|stock-transfer|stock-documents)/,
  'product-passports+green-claims+producer': /(product-passport|passport|green-claims|claims\.|producer)/,
  'experiments(A/B)': /(experiment|ab-routing|ab-site|ab-request|\/ab\/)/,
  'recommendations': /recommend/,
  'search-merchandising(rules,synonyms)': /(search-rules|search-synonyms|search-experiment)/,
  'price-lists+breaks+company-locations+payment-terms': /(price-list|price-break|company-location|payment-terms)/,
  'shipping-methods+pickup+local-delivery': /(shipping-method|pickup|local-delivery|shipping-admin|shipping-limits)/,
  'carriers(bring,postnord,porterbuddy,helthjem,instabox,dhl,ups,sendcloud,nshift)': /(bring|postnord|porterbuddy|helthjem|instabox|dhl|\/ups\.|sendcloud|nshift|carrier)/,
  'autopilot+follow-ups+skills+plans': /(autopilot|follow-up|saved-skills|assistant-skills|assistant-notices)/,
  'ads+conversions+feeds': /(ad-connections|ad-conversions|ad-payloads|ad-signals|\/ads\/|feeds?[-.\/]|feed-settings|platform-ad-)/,
  'staging+schedules+preview-links': /(staging|page-schedules|theme-schedules|preview-links|preview-token|schedule-tools)/,
  'store-copy': /store-copy/,
  'domains(buy,dns,register)': /(domain|dns-|registrar|zone-file|vercel-dns)/,
  'status-page': /(\/status[-.\/])/,
  'shopify-move': /(shopify|old-shop)/,
  'woocommerce+wordpress': /(woocommerce|wordpress)/,
  'mollie+payment-providers': /(mollie|payment-providers)/,
  'hosts+dac7': /(\/hosts?[-.\/]|host-payments|store-hosts|dac7|hosting)/,
  'work': /(\/work[-.\/])/,
  'kaizen-life': /kaizen-life/,
  'dream-factory': /dream/,
  'page-replicator': /replicat/,
  'bookings(appointments,stays)': /(booking|appointment|\/stays|calendar-sync|no-show)/,
  'subscriptions+boxes': /(subscription|standing-order|deliveries)/,
  'returns+withdrawals+exchanges': /(return|withdraw|exchange)/,
  'invoices+credit-notes': /(invoice)/,
  'inventory(locations,counts)': /(inventory|stock-)/,
  'privacy(gdpr)': /privacy|erasure/,
  'content-reports+moderation(DSA)': /(content-report|content-moderation)/,
  'blog-comments+authors+blogs': /(blog)/,
  'content-types+custom-fields': /(content-types|content-entries|content-admin|custom-fields|field-)/,
  'sandbox(try builder)': /sandbox/,
  'docs-portal': /docs/,
  'support+chat': /(support|chat)/,
  'analytics+reports': /(analytics|report)/,
  'themes cluster(theme,design-preset,starter,pack,demo,signature,launch)': /(theme|design-preset|design-variations|store-starter|content-pack|pack-|demo-|signature|launch-themes|home-takes|template)/,
  'instagram': /instagram/,
  'quotes+product-question': /(quote|product-question)/,
  'live-drills': /live-drills/,
  'legal-writer+sources': /legal/,
};
const out=[];
for (const [name,re] of Object.entries(F)){
  const acc={code:0,test:0,files:0,tfiles:0,lib:0,server:0,app:0,components:0,db:0,e2e:0};
  for(const r of rows){
    const p=r.p.toLowerCase();
    if(!re.test(p)) continue;
    const isTest=/\.test\.tsx?$/.test(p) || p.startsWith('e2e/');
    if(isTest){acc.test+=r.n; acc.tfiles++;} else {acc.code+=r.n; acc.files++; const d=p.split('/')[1]; if(acc[d]!==undefined) acc[d]+=r.n;}
  }
  out.push({name,...acc});
}
out.sort((a,b)=>b.code-a.code);
console.log('feature | code lines | files | lib | server | app | components | test lines | test files');
for(const o of out) console.log(`${o.name} | ${o.code} | ${o.files} | ${o.lib} | ${o.server} | ${o.app} | ${o.components} | ${o.test} | ${o.tfiles}`);
if(process.argv[2]){ const re=F[process.argv[2]]; for(const r of rows) if(re.test(r.p.toLowerCase())) console.log(r.n, r.p); }
