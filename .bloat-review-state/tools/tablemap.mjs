import fs from 'node:fs';
const tables = fs.readFileSync('tables.txt','utf8').trim().split('\n').filter(t=>!['account_id','store_id'].includes(t));
const empty = new Set(fs.readFileSync('empty.txt','utf8').trim().split('\n'));
const G = {
 'email marketing (subscribers, segments, broadcasts, automations)': /^(broadcast|marketing_(subscribers|consent)|segments$|automation|email_opt_outs|signup_incentives)/,
 'sms': /^sms_/,
 'bonus': /^bonus_/,
 'store referral (affiliates)': /^affiliate/,
 'platform referrals': /^(referral|referrers)/,
 'creators': /^creator/,
 'gift cards': /gift_card/,
 'product reviews': /^(product_reviews|review_)/,
 'deals/leads/activities/pipedrive/email filing': /^(deal|activities|lead_|crm_|filed_emails|email_filing|customer_notes)/,
 'own books (ledger etc.)': /^(ledger_|books_|bank_|recurring_costs|turnover_|supplier_invoices)/,
 'tripletex': /^tripletex/,
 'fiken': /^fiken/,
 'e-invoices/peppol': /^(einvoice|peppol)/,
 'workflows (store+platform)': /workflow/,
 'order rules': /^order_rule/,
 'checkout rules+fields': /^checkout_(rule|field)/,
 'webhook endpoints + integrations': /(webhook_endpoints|integration)/,
 'api tokens/apps/oauth/developers': /^(api_|platform_api|apps$|custom_apps|developers|oauth_|storefront_tokens)/,
 'marketplace (ebay)': /^marketplace/,
 'suppliers/drop ship/purchase orders/transfers': /^(supplier|purchase_order|stock_transfer|stock_requests|stock_alerts|variant_cost)/,
 'passports/producer/customs': /^(product_passports|producer_|customs_|economic_operators|product_schemes|product_safety)/,
 'experiments': /^experiment/,
 'recommendations': /^recommendation/,
 'search merchandising': /^search_(rules|synonyms|clicks)/,
 'price lists/b2b depth': /^(price_list|price_breaks|company_location|order_payment_terms|customer_companies|company_invites)/,
 'shipping methods/carriers/tracking': /^(shipping_(carriers|method|profiles|settings|zones)|pickup_options|local_delivery|carrier_labels|shipment_tracking|delivery_quotes)/,
 'autopilot/assistant plans': /^(autopilot_|assistant_(follow|plan|skills))/,
 'ads/feeds/spend': /^(ad_|feed_settings|marketing_spend|platform_ad|platform_marketing)/,
 'staging/schedules/preview': /^(site_staging|page_schedules|theme_schedules|preview_links)/,
 'store copy': /^store_cop/,
 'domains': /^(dns_|domain_)/,
 'status page': /^status_/,
 'returns/withdrawals/exchanges': /^(return|withdrawal)/,
 'invoices/credit notes': /^(invoices$|credit_notes|document_)/,
 'hosts': /^host/,
 'privacy/DSA/accessibility': /^(privacy_requests|content_reports|accessibility_settings|dispute_evidence)/,
 'blog depth/content types/fields': /^(blog_|content_entries|field_(search|values))/,
 'mollie/providers': /^(mollie|checkout_providers|payment_credentials)/,
 'analytics extras (targets, alerts, saved reports)': /^(analytics_|saved_reports|report_schedules|platform_targets|capacity_events)/,
 'order ops (edits, tags, views, bulk)': /^(order_(edit|tags|views|discount|line_components)|bulk_edit)/,
 'shopify move': /^(old_shops|shop_move)/,
 'theme extras': /^(store_themes|theme_submissions|template_activations|store_home_takes|page_theme_detaches)/,
};
let assigned=new Set();
for(const [g,re] of Object.entries(G)){
  const ts=tables.filter(t=>re.test(t)); const e=ts.filter(t=>empty.has(t));
  ts.forEach(t=>assigned.add(t));
  console.log(`${g}: ${e.length}/${ts.length} empty  [non-empty: ${ts.filter(t=>!empty.has(t)).join(', ')||'-'}]`);
}
const rest=[...empty].filter(t=>!assigned.has(t));
console.log('\nunassigned empty:', rest.length, rest.join(', '));
