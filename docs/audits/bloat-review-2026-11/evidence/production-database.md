# Production database statistics (Supabase `ybsozesfuxuitoacntfo`, read 11 Nov 2026)

Read-only, from Postgres's own statistics views (`pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_stat_statements`, `cron.job`)
and `commerce.cron_jobs`. Counters run since the statistics were last reset on 25 Aug 2026 (78 days). No personal data was read.

## Size and shape

| Measure | Value |
|---|---|
| Stores | 60 |
| Orders (all stores, all time) | 102 (134 order lines, 95 payments) |
| Database size | 731 MB: the `cron` schema (pg_cron's run log) 564 MB, `commerce` 124 MB, `pg_catalog` 27 MB, `net` 8.5 MB; a leftover `commerce_legacy` schema holds 34 tables and 96 rows |
| Tables in `commerce` | 486 |
| ... that have never held a row (no insert since the counters began on 25 August) | 245 (50%); 255 hold no row today |
| Indexes in `commerce` | 1,989 (44 MB) |
| ... never used by a query (`idx_scan = 0`) | 1,006 (51%), 19 MB |
| Functions in `commerce` | 617 |
| Triggers in `commerce` | 391 |

Caveat on indexes: with tables this small, the planner prefers a sequential scan, so "never used" partly means "table too
small to need it yet", and unique/primary-key indexes enforce rules whether or not they are scanned. Still, e.g. `orders` has
34 indexes for 102 rows (10 never used), `payments` 12 (5 unused), `stores` 15, `store_starters` 11 (13 rows).

## Largest tables

| Table | Rows | Total size | Note |
|---|---|---|---|
| docs_index | 1,845 | 33 MB | 49,347 updates on 1,845 rows: rewritten again and again (embeddings) |
| pages | 1,389 | 9.1 MB | 199,789 seq scans reading 202 M rows |
| ai_usage | 19,104 | 6.9 MB | |
| font_files | 163 | 5.7 MB | |
| page_versions | 642 | 5.4 MB | |
| media_embeddings | 468 | 4.7 MB | 13,414 updates on 468 rows |
| knowledge_chunks | 250 | 3.7 MB | 1,060 inserts, 810 deletes, 91,200 `delete ... where page_id` calls |
| media | 699 | 3.3 MB | |
| status_checks | 20,547 | 3.2 MB | grows every 5 minutes, never pruned (0 deletes) |
| product_embeddings | 305 | 2.7 MB | 24,807 seq scans |
| postal_points | 28,754 | 2.5 MB | |

## Tables read by sequential scan the most (rows read by seq scan)

| Table | Rows | Seq scans | Rows read by seq scan |
|---|---|---|---|
| cookie_scans | 1,945 | 1,101,927 | 962 M |
| pages | 1,389 | 199,789 | 203 M |
| media | 699 | 43,240 | 17 M |
| media_embeddings | 468 | 53,647 | 16 M |
| product_variants | 841 | 235,251 | 13 M |
| terms | 85 | 183,724 | 11 M |
| countries | 28 | 375,215 | 10.5 M |
| status_checks | 20,547 | 1,072 | 10.5 M |
| stores | 60 | 204,477 | 9.4 M (plus 12 M index scans) |
| theme_shots | 72 | 88,341 | 8.4 M |
| orders | 102 | 79,520 | 7 M |
| store_starters | 13 | 172,490 | 2.2 M |
| payment_providers | 60 | 67,827 | 2.1 M |

## Statements that cost the most time in total (role `postgres`, the app)

| Calls | Total | Mean | Rows returned | Statement (start) |
|---|---|---|---|---|
| 352,514 | 3,974 s | 11.3 ms | | `SELECT net.http_post(...)`: pg_cron calling the app's cron routes |
| 79,778 | 781 s | 9.8 ms | 2,334,038 | `select id, slug, published, published_at, first_published_at from commerce.pages where store_id is not distinct from $1 and type = $2 and published_at is not null order by created_at`: every published page of a type WITH its whole content, 29 rows a call |
| 1,831 | 266 s | 145 ms | | `with m as (select id, url, thumbnail_url from commerce.media where store_id = $1 and id in (...)) select m.id as media_id, ... as source, p.id::text as ref_id ...`: where each picture is used (media library); other shapes of the same statement: 925 ms mean (43 calls), 133 ms (198), 66 ms (205), 47 ms (776) |
| 6,782 | 253 s | 37 ms | | `select u.store_id, coalesce(sum(coalesce(round(u.input_tokens * p.input_per_million + ...` : AI cost summed from `ai_usage` on each call (second shape: 1,732 calls, 57 ms mean) |
| 49,338 | 192 s | 3.9 ms | 1,796 | `with sites as (select $4::uuid as store_id union all select s.id from commerce.stores s where s.status = $5 and not s.starter and (s.is_template or s.setup_completed_at is not null) and exists (...markets...` |
| 10,201 | 148 s | 14.5 ms | 38,062 | `with docs as (select t.store_id, t.product_id, t.locale, t.title, coalesce(t.description...) ... string_agg(te.name ...` : search documents / embeddings |
| 9,909 | 132 s | 13.3 ms | | `select commerce.issue_waiting_invoices($1, $2)` (per store, every 5 minutes) |
| 68,878 | 121 s | 1.8 ms | | `select exists (select from commerce.pages where store_id is not distinct from $1 and published is not null and jsonb_path_exists(published, $3))`: scans every published page's JSON for a component |
| 35,101 | 101 s | 2.9 ms | 348,763 | `select p.id, p.title, p.snapshot, (select max(v.number) ...) from commerce.design_presets p where p.published and p.archived_at is null`: every published theme WITH its whole snapshot |
| 457,349 + 107,700 | 84 s | 0.15 ms | | `insert into commerce.cron_jobs ... on conflict`: one upsert per job per run |
| 57,930 | 66 s | 1.1 ms | 497,123 | `select p.slug as address, p.slug, coalesce(nullif(p.published #>> ...` : page titles pulled out of each page's JSON |
| 2,571 | 42 s | 16 ms | 101,545 | `select p.id, p.type, p.slug, p.published, p.published_at, (select min(c.version) from commerce.knowledge_chunks ...` : every published page with content, for the knowledge base (also 17,955 calls and 3,608 calls in other shapes) |
| 9,909 | 35 s | 3.5 ms | | `select commerce.issue_missing_credit_notes($1)` |
| 4,035 | 30 s | 7.3 ms | | `select exists (select from commerce.vat_rates r join commerce.countries c ...` |
| 10,851 | 27 s | 2.5 ms | 107,917 | `select id, slug, title, summary, picture_url, listing, snapshot from commerce.design_presets where published ...` |
| 11,790 | 25 s | 2.1 ms | | `select commerce.bonus_expire_due($1)` |
| 24,463 | 20 s | 0.8 ms | 988,893 | `select distinct on (t.preset_id, coalesce(t.variation, ''), t.kind) ... from commerce.theme_shots ...`: 40 rows a call |
| 49,842 | 19 s | 0.4 ms | 140,596 | `select m.id, m.file_name, m.alt, m.alt_translations, e.content_hash from commerce.media m left join commerce.media_embeddings ...` |
| 70,257 | 17.5 s | 0.25 ms | | `select items from commerce.cookie_scans where store_id is not distinct from $1 and status = $2 order by finished_at desc limit $3` (the source of 1.1 M seq scans on `cookie_scans`) |

## Statements called the most

| Calls | Statement (start) |
|---|---|
| 560,090 | `select slug from commerce.stores where id = $1` |
| 278,393 | `select lang, count(*)::int as n, max(updated_at)::text as v from commerce.ui_translations group by lang` (the table is empty) |
| 91,200 | `delete from commerce.knowledge_chunks where page_id = $1` (782 rows deleted in all) |
| 89,690 + 57,395 + 50,840 + 39,638 | `select * from commerce.ai_providers where enabled and (store_id is null [or store_id = $1]) order by store_id nulls last` |
| 85,203 + 45,613 | `select id, kind, parent_id, name, slug, ... from commerce.terms where store_id is not distinct from $1 and content...` |
| 79,778 | the pages statement above |
| 71,422 | `select pg_advisory_xact_lock(hashtext($1))` |
| 70,278 | `select kind, name, domain, category, provider, purpose from commerce.cookie_notes where store_id is not distinct from $1` (table empty) |
| 70,257 | `select items from commerce.cookie_scans ...` |
| 69,938 | `select id, name, items from commerce.menus where store_id is null order by name` |
| 69,075 | `select coalesce((select ai_autonomy_paused from commerce.platform_settings limit 1), false)` |
| 68,878 | the `jsonb_path_exists(published, ...)` statement above |
| 67,601 | `select p.id, p.slug, p.published, ... p.slug <> $1 as moved from commerce.pages p where ... (p.slug = $4 or p.id = (select r.page_id from ...` |
| 66,533 x 2 | `update commerce.integration_deliveries set next_attempt_at ...` and `delete from commerce.integration_deliveries where created_at < ...` (the table has never held a row) |
| 65,200 x 2 | `update commerce.cookie_scans set status ...` (the every-minute cookie-scan route) |
| 59,408 | `select st.id, st.design_preset_id, st.pack_key, s.name from commerce.store_starters st join commerce.stores s ...` (589,102 rows returned) |
| 53,887 | `select navigation, business, tracking, fonts, custom_css, theme, locales, header_menu_id, footer_menu_id from commerce.platform_settings` |
| 48,492 | `select * from commerce.chat_agents where store_id is null` |
| 46,265 | `select role, page_id from commerce.platform_page_roles` |
| 45,544 | `select seo from commerce.platform_settings` |
| 44,555 + 44,468 | `select p.id, p.published from commerce.platform_settings s join commerce.pages p on p.id = s.header_id / s.footer_id ...` |
| 42,211 | `select css from commerce.fonts where slug = $1` |
| 42,078 | `select enabled, cookie_days from commerce.referral_program()` |
| 40,141 | `select c.id, c.store_id, c.queued_at ... from commerce.support_conversations c join commerce.support_settings ...` |

## Scheduled work (pg_cron -> `net.http_post` -> a Vercel function)

`cron.job` in production:

| Job | Schedule |
|---|---|
| kaizen-autopilot | every minute |
| kaizen-broadcasts | every minute |
| kaizen-cookie-scan | every minute |
| kaizen-dream-factory | every minute |
| kaizen-integrations | every minute |
| kaizen-pack-pictures | every minute |
| kaizen-page-jobs | every minute |
| kaizen-page-looks | every minute |
| kaizen-theme-shots | every minute |
| kaizen-cart-reminders (the dispatcher) | every 5 minutes |
| kaizen-subscription-reminders, kaizen-usage, two retention deletes | daily |

Nine routes are called every minute: 12,960 function calls a day, plus 288 dispatcher runs. `commerce.cron_jobs` says what
each did last: `route.pack-pictures` 1 ms, `route.page-jobs` 0 ms, `route.broadcasts` 0 ms, `route.theme-shots` 0 ms,
`route.autopilot` 0 ms, `route.page-looks` 0 ms, `route.dream-factory` 0 ms, `route.cookie-scan` 26 ms,
`route.integrations` 72 ms. They find nothing to do almost every time.

The five-minute dispatcher (`route.cart-reminders`, last run 1,341 ms... its own time; the jobs' times add up to more) runs
**84 jobs** each time, all of them every 300 s, whatever the store count or whether the feature has ever been used. Last
durations (ms): status 1284, alt-texts 604, media 555, knowledge 542, invoices 266, tripletex 265, ledger 261, life-handoffs 248,
embeddings 241, platform-books 226, supplier-orders 224, sms 221, returns 220, bonus 219, schedules 216, content-moderation 213,
legal-sources 204, experiments 197, recurring 187, docs-index 184, oauth-tokens 176, plans 174, payments 171, legal-upkeep 168,
trials 164, follow-ups 163, tracking 161, sandboxes 161, live-drills 158, docs-guide-idle 156, recommendations 144,
business-changes 138, einvoices 136, deliveries 134, docs-counts 129, house-customers 127, carts 119, api-idempotency 119,
legal-writes 103, ui-translations 103, vat-labels 102, assistant-approvals 99, report-emails 95, autopilot-budgets 94,
autopilot-reports 93, fonts 90, summaries 88, analytics-alerts 88, stripe-webhooks 87, support-actions 84, auto-archive 82,
support-idle 82, support-summaries 82, edit-expiry 80, approval-expiry 80, low-stock 79, draft-expiry 78, data-jobs 77,
shop-moves 74, replications 73, store-copies 71, instagram 71, affiliates 68, fiken 66, pipedrive 66, platform-briefing 66,
activities 63, forms 58, chat 56, cache 53, ai-picture-marks 52, commissions 50, searches 47, bookings 45, calendars 44,
ebay 8, autopilot-effects 7, theme-purchases 7, domain-registrations 6, domain-purchases 5, theme-updates 5, secret-rotation 5,
platform-theme-updates 4. Sum: about 12.5 s of database-bound work every five minutes, mostly for features with empty tables.

## The 245 tables that have never held a row

abandoned_checkouts, abandoned_plan_checkouts, accessibility_settings, activities, ad_connections, ad_conversions,
affiliate_attributions, analytics_alert_sends, analytics_settings, analytics_targets, api_app_idempotency_keys,
api_idempotency_keys, api_tokens, api_uploads, apps, assistant_follow_ups, assistant_plan_steps, assistant_plans,
assistant_skills, automation_sends, automations, autopilot_effects, autopilot_event_checks, autopilot_events,
autopilot_reports, autopilot_reviews, autopilot_settings, blog_authors, blog_comments, bonus_allocations, bonus_entries,
bonus_rewards, books_inbox, broadcast_link_clicks, broadcast_recipients, broadcast_templates, broadcasts, bulk_edit_batches,
bulk_edit_items, calendar_feeds, campaigns, capacity_events, carrier_labels, cart_gift_cards, checkout_fields,
checkout_providers, checkout_rule_skips, checkout_rules, company_location_buyers, company_locations, content_entries,
content_reports, cookie_notes, creator_attributions, creator_commissions, creator_payouts, creator_settings, creators,
credit_notes, crm_move_links, crm_moves, custom_apps, customer_notes, customs_settings, deal_links, delivery_quotes,
developers, discount_code_items, dispute_evidence, dns_changes, dns_zones, docs_feedback, docs_search_misses,
document_deliveries, document_pdf_state, domain_purchases, domain_registrants, domain_registrations, email_opt_outs,
email_templates, experiment_carts, experiment_events, experiment_exposures, feed_settings, field_search, field_values,
fiken_connections, fiken_sync, filed_emails, gift_card_entries, gift_card_settings, gift_cards, google_places,
host_commissions, host_stripe_accounts, host_tax_details, idempotency_keys, instagram_accounts, integration_deliveries,
invoices, kaizen_life_handoffs, knowledge_documents, lead_decisions, ledger_budgets, ledger_vouchers, ledger_waiting,
limit_overrides, local_delivery_areas, market_availability, marketing_consent_events, marketing_spend,
marketing_subscribers, marketplace_connections, marketplace_listings, marketplace_orders, mollie_connections,
not_found_ignored, notification_settings, oauth_clients, oauth_grants, oauth_store_cutoffs, oauth_tokens, old_shops,
order_discount_codes, order_edit_lines, order_edits, order_line_components, order_payment_terms, order_rule_runs,
order_rules, order_tags, order_views, page_schedules, page_theme_detaches, payment_credentials, pickup_options,
plan_reminder_steps, platform_ad_conversions, platform_api_tokens, platform_integration_deliveries, platform_integrations,
platform_marketing_spend, platform_payout_lines, platform_payouts, platform_sales, platform_targets,
platform_webhook_endpoints, platform_workflow_runs, platform_workflows, preview_links, price_breaks,
price_list_assignments, price_list_breaks, price_list_prices, price_list_products, price_list_quantity_rules, price_lists,
privacy_requests, producer_registrations, product_groups, product_market_texts, product_passports, product_reviews,
product_settings, purchase_order_lines, purchase_orders, push_subscriptions, recommendation_adds, recommendation_events,
recommendation_rules, recommendation_settings, recurring_costs, referral_allocations, referral_entries, referral_visits,
referrals, report_schedules, resource_blocks, return_exchange_lines, return_exchanges, return_lines, return_settings,
returns, review_pictures, review_requests, review_settings, saved_reports, search_clicks, search_rules, search_synonyms,
segments, shipment_tracking, shipping_carriers, shipping_method_rates, shipping_methods, shipping_profiles,
shipping_settings, shipping_zones, shop_move_items, signup_incentives, site_staging_pages, site_stagings, sms_campaigns,
sms_consent_events, sms_messages, sms_settings, sms_subscribers, staff_alert_recipients, staff_alert_settings,
status_incident_updates, status_incidents, status_subscribers, stock_alerts, stock_requests, stock_transfer_lines,
stock_transfers, store_business_changes, store_copies, store_copy_files, store_home_takes, store_integrations,
store_themes, storefront_tokens, supplier_invoices, supplier_order_lines, supplier_orders, suppliers, support_actions,
support_replies, tax_rate_overrides, tax_report_exports, template_activations, theme_schedules, theme_submissions,
turnover_thresholds, ui_translations, unsent_closures, variant_cost_history, webhook_endpoints, withdrawal_attempts,
withdrawal_request_lines, withdrawal_requests, work_timers, workflow_runs, workflows

(An empty table is not proof the feature is unwanted: several were built in the last weeks. It is proof that no store has
used it yet, and that any work done for it on every request or every five minutes is, today, done for nobody.)

## The queries

Read-only, on statistics views. Run them again to check a step's "done when".

```sql
-- Tables: rows, size, how they are read.
select relname, n_live_tup, n_tup_ins, seq_scan, seq_tup_read, idx_scan, pg_total_relation_size(relid) as bytes
from pg_stat_user_tables where schemaname = 'commerce' order by bytes desc;

-- Indexes never scanned.
select relname, indexrelname, pg_relation_size(indexrelid) as bytes
from pg_stat_user_indexes where schemaname = 'commerce' and idx_scan = 0 order by bytes desc;

-- Size by schema (the scheduler's log is the cron schema).
select n.nspname, count(*), pg_size_pretty(sum(pg_total_relation_size(c.oid)))
from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'm') group by 1 order by sum(pg_total_relation_size(c.oid)) desc;

-- The app's statements by total time; order by calls for the most-called.
select calls, round(total_exec_time::numeric) as total_ms, round(mean_exec_time::numeric, 2) as mean_ms, rows, left(regexp_replace(query, '\s+', ' ', 'g'), 260) as query
from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid
where r.rolname = 'postgres' order by total_exec_time desc limit 40;

-- The schedule, and what each job did last.
select jobname, schedule, active from cron.job order by jobname;
select job, every_seconds, runs, failures, last_duration_ms from commerce.cron_jobs order by runs desc;
```
