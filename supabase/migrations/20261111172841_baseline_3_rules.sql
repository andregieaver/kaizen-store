-- kaizen:baseline-through=20261111172838_sms_campaign_index.sql
-- Keys, indexes, triggers and row security, added after the data as a restore does.
-- Made by scripts/squash-migrations.mjs from every migration up to 20261111172838_sms_campaign_index.sql (code review FD3, D572); the squashed
-- files are in supabase/archive/20261111172838/. Never edit this file: production recorded it without running it.
--
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

--
-- Name: abandoned_checkouts abandoned_checkouts_cart_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_checkouts
    ADD CONSTRAINT abandoned_checkouts_cart_key UNIQUE (store_id, cart_id);


--
-- Name: abandoned_checkouts abandoned_checkouts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_checkouts
    ADD CONSTRAINT abandoned_checkouts_pkey PRIMARY KEY (id);


--
-- Name: abandoned_checkouts abandoned_checkouts_token_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_checkouts
    ADD CONSTRAINT abandoned_checkouts_token_unique UNIQUE (token);


--
-- Name: abandoned_plan_checkouts abandoned_plan_checkouts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_plan_checkouts
    ADD CONSTRAINT abandoned_plan_checkouts_pkey PRIMARY KEY (id);


--
-- Name: abandoned_plan_checkouts abandoned_plan_checkouts_store_id_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_plan_checkouts
    ADD CONSTRAINT abandoned_plan_checkouts_store_id_unique UNIQUE (store_id);


--
-- Name: abandoned_plan_checkouts abandoned_plan_checkouts_token_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_plan_checkouts
    ADD CONSTRAINT abandoned_plan_checkouts_token_unique UNIQUE (token);


--
-- Name: access_requests access_requests_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.access_requests
    ADD CONSTRAINT access_requests_pkey PRIMARY KEY (id);


--
-- Name: accessibility_settings accessibility_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.accessibility_settings
    ADD CONSTRAINT accessibility_settings_pkey PRIMARY KEY (store_id);


--
-- Name: account_recovery_codes account_recovery_codes_hash_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.account_recovery_codes
    ADD CONSTRAINT account_recovery_codes_hash_key UNIQUE (account_id, code_hash);


--
-- Name: account_recovery_codes account_recovery_codes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.account_recovery_codes
    ADD CONSTRAINT account_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_auth_user_id_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.accounts
    ADD CONSTRAINT accounts_auth_user_id_unique UNIQUE (auth_user_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activities activities_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_store_id_key UNIQUE (store_id, id);


--
-- Name: ad_connections ad_connections_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_connections
    ADD CONSTRAINT ad_connections_pkey PRIMARY KEY (id);


--
-- Name: ad_connections ad_connections_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_connections
    ADD CONSTRAINT ad_connections_store_id_key UNIQUE (store_id, id);


--
-- Name: ad_connections ad_connections_store_platform; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_connections
    ADD CONSTRAINT ad_connections_store_platform UNIQUE (store_id, platform);


--
-- Name: ad_conversions ad_conversions_once; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_conversions
    ADD CONSTRAINT ad_conversions_once UNIQUE (store_id, order_id, platform, event);


--
-- Name: ad_conversions ad_conversions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_conversions
    ADD CONSTRAINT ad_conversions_pkey PRIMARY KEY (id);


--
-- Name: affiliate_attributions affiliate_attributions_order_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_attributions
    ADD CONSTRAINT affiliate_attributions_order_key UNIQUE (store_id, order_id);


--
-- Name: affiliate_attributions affiliate_attributions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_attributions
    ADD CONSTRAINT affiliate_attributions_pkey PRIMARY KEY (id);


--
-- Name: affiliate_attributions affiliate_attributions_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_attributions
    ADD CONSTRAINT affiliate_attributions_store_id_key UNIQUE (store_id, id);


--
-- Name: affiliate_settings affiliate_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_settings
    ADD CONSTRAINT affiliate_settings_pkey PRIMARY KEY (store_id);


--
-- Name: affiliates affiliates_code_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliates
    ADD CONSTRAINT affiliates_code_key UNIQUE (store_id, code);


--
-- Name: affiliates affiliates_store_id_customer_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliates
    ADD CONSTRAINT affiliates_store_id_customer_id_pk PRIMARY KEY (store_id, customer_id);


--
-- Name: ai_eval_runs ai_eval_runs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_eval_runs
    ADD CONSTRAINT ai_eval_runs_pkey PRIMARY KEY (id);


--
-- Name: ai_model_prices ai_model_prices_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_model_prices
    ADD CONSTRAINT ai_model_prices_key UNIQUE (provider, model, effective_from);


--
-- Name: ai_model_prices ai_model_prices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_model_prices
    ADD CONSTRAINT ai_model_prices_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_providers
    ADD CONSTRAINT ai_providers_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


--
-- Name: analytics_alert_sends analytics_alert_sends_store_id_day_alert_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.analytics_alert_sends
    ADD CONSTRAINT analytics_alert_sends_store_id_day_alert_id_pk PRIMARY KEY (store_id, day, alert_id);


--
-- Name: analytics_settings analytics_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.analytics_settings
    ADD CONSTRAINT analytics_settings_pkey PRIMARY KEY (store_id);


--
-- Name: analytics_targets analytics_targets_month_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.analytics_targets
    ADD CONSTRAINT analytics_targets_month_key UNIQUE (store_id, month);


--
-- Name: analytics_targets analytics_targets_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.analytics_targets
    ADD CONSTRAINT analytics_targets_pkey PRIMARY KEY (id);


--
-- Name: api_app_idempotency_keys api_app_idempotency_keys_grant_id_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_app_idempotency_keys
    ADD CONSTRAINT api_app_idempotency_keys_grant_id_key_pk PRIMARY KEY (grant_id, key);


--
-- Name: api_idempotency_keys api_idempotency_keys_token_id_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_idempotency_keys
    ADD CONSTRAINT api_idempotency_keys_token_id_key_pk PRIMARY KEY (token_id, key);


--
-- Name: api_tokens api_tokens_hash_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_tokens
    ADD CONSTRAINT api_tokens_hash_key UNIQUE (token_hash);


--
-- Name: api_tokens api_tokens_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_tokens
    ADD CONSTRAINT api_tokens_pkey PRIMARY KEY (id);


--
-- Name: api_tokens api_tokens_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_tokens
    ADD CONSTRAINT api_tokens_store_id_key UNIQUE (store_id, id);


--
-- Name: api_uploads api_uploads_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_uploads
    ADD CONSTRAINT api_uploads_pkey PRIMARY KEY (id);


--
-- Name: api_uploads api_uploads_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_uploads
    ADD CONSTRAINT api_uploads_store_id_key UNIQUE (store_id, id);


--
-- Name: appointment_settings appointment_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.appointment_settings
    ADD CONSTRAINT appointment_settings_pkey PRIMARY KEY (product_id);


--
-- Name: apps apps_client_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.apps
    ADD CONSTRAINT apps_client_key UNIQUE (client_id);


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);


--
-- Name: assistant_approvals assistant_approvals_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_approvals
    ADD CONSTRAINT assistant_approvals_pkey PRIMARY KEY (id);


--
-- Name: assistant_conversations assistant_conversations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_conversations
    ADD CONSTRAINT assistant_conversations_pkey PRIMARY KEY (id);


--
-- Name: assistant_follow_ups assistant_follow_ups_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_follow_ups
    ADD CONSTRAINT assistant_follow_ups_pkey PRIMARY KEY (id);


--
-- Name: assistant_goals assistant_goals_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_goals
    ADD CONSTRAINT assistant_goals_pkey PRIMARY KEY (id);


--
-- Name: assistant_memories assistant_memories_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_memories
    ADD CONSTRAINT assistant_memories_pkey PRIMARY KEY (id);


--
-- Name: assistant_messages assistant_messages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_messages
    ADD CONSTRAINT assistant_messages_pkey PRIMARY KEY (id);


--
-- Name: assistant_notices assistant_notices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_notices
    ADD CONSTRAINT assistant_notices_pkey PRIMARY KEY (id);


--
-- Name: assistant_plan_steps assistant_plan_steps_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plan_steps
    ADD CONSTRAINT assistant_plan_steps_pkey PRIMARY KEY (id);


--
-- Name: assistant_plans assistant_plans_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plans
    ADD CONSTRAINT assistant_plans_pkey PRIMARY KEY (id);


--
-- Name: assistant_skills assistant_skills_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_skills
    ADD CONSTRAINT assistant_skills_key UNIQUE NULLS NOT DISTINCT (account_id, store_id, key);


--
-- Name: assistant_skills assistant_skills_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_skills
    ADD CONSTRAINT assistant_skills_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: automation_sends automation_sends_store_id_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.automation_sends
    ADD CONSTRAINT automation_sends_store_id_key_pk PRIMARY KEY (store_id, key);


--
-- Name: automations automations_store_id_kind_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.automations
    ADD CONSTRAINT automations_store_id_kind_pk PRIMARY KEY (store_id, kind);


--
-- Name: autopilot_effects autopilot_effects_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_effects
    ADD CONSTRAINT autopilot_effects_pkey PRIMARY KEY (audit_id);


--
-- Name: autopilot_event_checks autopilot_event_checks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_event_checks
    ADD CONSTRAINT autopilot_event_checks_pkey PRIMARY KEY (store_id);


--
-- Name: autopilot_events autopilot_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_events
    ADD CONSTRAINT autopilot_events_pkey PRIMARY KEY (id);


--
-- Name: autopilot_events autopilot_events_ref_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_events
    ADD CONSTRAINT autopilot_events_ref_key UNIQUE (store_id, kind, ref);


--
-- Name: autopilot_reports autopilot_reports_period_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reports
    ADD CONSTRAINT autopilot_reports_period_key UNIQUE NULLS NOT DISTINCT (store_id, account_id, kind, period_start);


--
-- Name: autopilot_reports autopilot_reports_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reports
    ADD CONSTRAINT autopilot_reports_pkey PRIMARY KEY (id);


--
-- Name: autopilot_reviews autopilot_reviews_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reviews
    ADD CONSTRAINT autopilot_reviews_pkey PRIMARY KEY (id);


--
-- Name: autopilot_settings autopilot_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_settings
    ADD CONSTRAINT autopilot_settings_pkey PRIMARY KEY (id);


--
-- Name: autopilot_settings autopilot_settings_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_settings
    ADD CONSTRAINT autopilot_settings_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: bank_lines bank_lines_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_lines
    ADD CONSTRAINT bank_lines_key UNIQUE (book_id, ledger_account, line_key);


--
-- Name: bank_lines bank_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_lines
    ADD CONSTRAINT bank_lines_pkey PRIMARY KEY (id);


--
-- Name: bank_lines bank_lines_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_lines
    ADD CONSTRAINT bank_lines_store_id_key UNIQUE (store_id, id);


--
-- Name: bank_statements bank_statements_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_statements
    ADD CONSTRAINT bank_statements_pkey PRIMARY KEY (id);


--
-- Name: bank_statements bank_statements_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_statements
    ADD CONSTRAINT bank_statements_store_id_key UNIQUE (store_id, id);


--
-- Name: blog_authors blog_authors_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blog_authors
    ADD CONSTRAINT blog_authors_pkey PRIMARY KEY (id);


--
-- Name: blog_authors blog_authors_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blog_authors
    ADD CONSTRAINT blog_authors_store_id_key UNIQUE (store_id, id);


--
-- Name: blog_comments blog_comments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blog_comments
    ADD CONSTRAINT blog_comments_pkey PRIMARY KEY (id);


--
-- Name: blogs blogs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blogs
    ADD CONSTRAINT blogs_pkey PRIMARY KEY (id);


--
-- Name: blogs blogs_store_handle_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blogs
    ADD CONSTRAINT blogs_store_handle_key UNIQUE (store_id, handle);


--
-- Name: blogs blogs_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blogs
    ADD CONSTRAINT blogs_store_id_key UNIQUE (store_id, id);


--
-- Name: bonus_allocations bonus_allocations_store_id_lot_id_entry_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_allocations
    ADD CONSTRAINT bonus_allocations_store_id_lot_id_entry_id_pk PRIMARY KEY (store_id, lot_id, entry_id);


--
-- Name: bonus_entries bonus_entries_idempotency_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_idempotency_key UNIQUE (store_id, idempotency_key);


--
-- Name: bonus_entries bonus_entries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_pkey PRIMARY KEY (id);


--
-- Name: bonus_entries bonus_entries_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_store_id_key UNIQUE (store_id, id);


--
-- Name: bonus_rewards bonus_rewards_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_rewards
    ADD CONSTRAINT bonus_rewards_pkey PRIMARY KEY (id);


--
-- Name: bonus_rewards bonus_rewards_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_rewards
    ADD CONSTRAINT bonus_rewards_store_id_key UNIQUE (store_id, id);


--
-- Name: bonus_settings bonus_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_settings
    ADD CONSTRAINT bonus_settings_pkey PRIMARY KEY (store_id);


--
-- Name: booking_resources booking_resources_calendar_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.booking_resources
    ADD CONSTRAINT booking_resources_calendar_token_key UNIQUE (calendar_token);


--
-- Name: booking_resources booking_resources_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.booking_resources
    ADD CONSTRAINT booking_resources_pkey PRIMARY KEY (id);


--
-- Name: booking_resources booking_resources_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.booking_resources
    ADD CONSTRAINT booking_resources_store_id_key UNIQUE (store_id, id);


--
-- Name: booking_seasons booking_seasons_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.booking_seasons
    ADD CONSTRAINT booking_seasons_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bookings
    ADD CONSTRAINT bookings_store_id_key UNIQUE (store_id, id);


--
-- Name: books_email books_email_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.books_email
    ADD CONSTRAINT books_email_pkey PRIMARY KEY (store_id);


--
-- Name: books_inbox books_inbox_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.books_inbox
    ADD CONSTRAINT books_inbox_pkey PRIMARY KEY (id);


--
-- Name: books_inbox books_inbox_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.books_inbox
    ADD CONSTRAINT books_inbox_store_id_key UNIQUE (store_id, id);


--
-- Name: brand_profiles brand_profiles_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.brand_profiles
    ADD CONSTRAINT brand_profiles_pkey PRIMARY KEY (id);


--
-- Name: brand_profiles brand_profiles_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.brand_profiles
    ADD CONSTRAINT brand_profiles_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: broadcast_link_clicks broadcast_link_clicks_broadcast_id_link_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_link_clicks
    ADD CONSTRAINT broadcast_link_clicks_broadcast_id_link_pk PRIMARY KEY (broadcast_id, link);


--
-- Name: broadcast_recipients broadcast_recipients_broadcast_id_subscriber_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_broadcast_id_subscriber_id_pk PRIMARY KEY (broadcast_id, subscriber_id);


--
-- Name: broadcast_templates broadcast_templates_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_templates
    ADD CONSTRAINT broadcast_templates_pkey PRIMARY KEY (id);


--
-- Name: broadcast_templates broadcast_templates_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_templates
    ADD CONSTRAINT broadcast_templates_store_id_key UNIQUE (store_id, id);


--
-- Name: broadcasts broadcasts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcasts
    ADD CONSTRAINT broadcasts_pkey PRIMARY KEY (id);


--
-- Name: broadcasts broadcasts_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcasts
    ADD CONSTRAINT broadcasts_store_id_key UNIQUE (store_id, id);


--
-- Name: bulk_edit_batches bulk_edit_batches_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bulk_edit_batches
    ADD CONSTRAINT bulk_edit_batches_pkey PRIMARY KEY (id);


--
-- Name: bulk_edit_batches bulk_edit_batches_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bulk_edit_batches
    ADD CONSTRAINT bulk_edit_batches_store_id_key UNIQUE (store_id, id);


--
-- Name: bulk_edit_items bulk_edit_items_batch_id_seq_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bulk_edit_items
    ADD CONSTRAINT bulk_edit_items_batch_id_seq_pk PRIMARY KEY (batch_id, seq);


--
-- Name: bundle_components bundle_components_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bundle_components
    ADD CONSTRAINT bundle_components_pkey PRIMARY KEY (bundle_variant_id, component_variant_id);


--
-- Name: calendar_feeds calendar_feeds_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.calendar_feeds
    ADD CONSTRAINT calendar_feeds_pkey PRIMARY KEY (id);


--
-- Name: calendar_feeds calendar_feeds_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.calendar_feeds
    ADD CONSTRAINT calendar_feeds_store_id_key UNIQUE (store_id, id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.campaigns
    ADD CONSTRAINT campaigns_store_id_key UNIQUE (store_id, id);


--
-- Name: capacity_events capacity_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.capacity_events
    ADD CONSTRAINT capacity_events_pkey PRIMARY KEY (id);


--
-- Name: carrier_labels carrier_labels_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carrier_labels
    ADD CONSTRAINT carrier_labels_pkey PRIMARY KEY (id);


--
-- Name: cart_gift_cards cart_gift_cards_store_id_cart_id_card_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_gift_cards
    ADD CONSTRAINT cart_gift_cards_store_id_cart_id_card_id_pk PRIMARY KEY (store_id, cart_id, card_id);


--
-- Name: cart_lines cart_lines_cart_variant_plan_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_lines
    ADD CONSTRAINT cart_lines_cart_variant_plan_key UNIQUE NULLS NOT DISTINCT (cart_id, variant_id, selling_plan_id, starts_at, gift_card_key);


--
-- Name: cart_lines cart_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_lines
    ADD CONSTRAINT cart_lines_pkey PRIMARY KEY (id);


--
-- Name: cart_reminder_steps cart_reminder_steps_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_reminder_steps
    ADD CONSTRAINT cart_reminder_steps_pkey PRIMARY KEY (id);


--
-- Name: cart_reminder_steps cart_reminder_steps_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_reminder_steps
    ADD CONSTRAINT cart_reminder_steps_store_id_key UNIQUE (store_id, id);


--
-- Name: carts carts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_pkey PRIMARY KEY (id);


--
-- Name: carts carts_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_store_id_key UNIQUE (store_id, id);


--
-- Name: chat_agents chat_agents_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.chat_agents
    ADD CONSTRAINT chat_agents_pkey PRIMARY KEY (id);


--
-- Name: chat_agents chat_agents_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.chat_agents
    ADD CONSTRAINT chat_agents_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: chat_usage chat_usage_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.chat_usage
    ADD CONSTRAINT chat_usage_key UNIQUE NULLS NOT DISTINCT (store_id, bucket, "window");


--
-- Name: chat_usage chat_usage_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.chat_usage
    ADD CONSTRAINT chat_usage_pkey PRIMARY KEY (id);


--
-- Name: checkout_accounts checkout_accounts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_accounts
    ADD CONSTRAINT checkout_accounts_pkey PRIMARY KEY (order_id);


--
-- Name: checkout_fields checkout_fields_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_fields
    ADD CONSTRAINT checkout_fields_pkey PRIMARY KEY (id);


--
-- Name: checkout_fields checkout_fields_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_fields
    ADD CONSTRAINT checkout_fields_store_id_key UNIQUE (store_id, id);


--
-- Name: checkout_providers checkout_providers_store_id_mode_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_providers
    ADD CONSTRAINT checkout_providers_store_id_mode_pk PRIMARY KEY (store_id, mode);


--
-- Name: checkout_rule_skips checkout_rule_skips_rule_id_reason_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rule_skips
    ADD CONSTRAINT checkout_rule_skips_rule_id_reason_pk PRIMARY KEY (rule_id, reason);


--
-- Name: checkout_rules checkout_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rules
    ADD CONSTRAINT checkout_rules_pkey PRIMARY KEY (id);


--
-- Name: checkout_rules checkout_rules_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rules
    ADD CONSTRAINT checkout_rules_store_id_key UNIQUE (store_id, id);


--
-- Name: company_invites company_invites_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_invites
    ADD CONSTRAINT company_invites_pkey PRIMARY KEY (id);


--
-- Name: company_invites company_invites_token_hash_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_invites
    ADD CONSTRAINT company_invites_token_hash_unique UNIQUE (token_hash);


--
-- Name: company_location_buyers company_location_buyers_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_location_buyers
    ADD CONSTRAINT company_location_buyers_pk PRIMARY KEY (location_id, customer_id);


--
-- Name: company_locations company_locations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_locations
    ADD CONSTRAINT company_locations_pkey PRIMARY KEY (id);


--
-- Name: company_locations company_locations_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_locations
    ADD CONSTRAINT company_locations_store_id_key UNIQUE (store_id, id);


--
-- Name: consents consents_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);


--
-- Name: content_entries content_entries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_entries
    ADD CONSTRAINT content_entries_pkey PRIMARY KEY (id);


--
-- Name: content_entries content_entries_type_slug_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_entries
    ADD CONSTRAINT content_entries_type_slug_key UNIQUE (type_id, slug);


--
-- Name: content_reports content_reports_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_reports
    ADD CONSTRAINT content_reports_pkey PRIMARY KEY (id);


--
-- Name: content_screened content_screened_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_screened
    ADD CONSTRAINT content_screened_pkey PRIMARY KEY (product_id);


--
-- Name: content_types content_types_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_types
    ADD CONSTRAINT content_types_pkey PRIMARY KEY (id);


--
-- Name: content_types content_types_store_key_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_types
    ADD CONSTRAINT content_types_store_key_key UNIQUE NULLS NOT DISTINCT (store_id, key);


--
-- Name: content_types content_types_store_slug_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_types
    ADD CONSTRAINT content_types_store_slug_key UNIQUE NULLS NOT DISTINCT (store_id, slug);


--
-- Name: cookie_notes cookie_notes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cookie_notes
    ADD CONSTRAINT cookie_notes_pkey PRIMARY KEY (id);


--
-- Name: cookie_scans cookie_scans_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cookie_scans
    ADD CONSTRAINT cookie_scans_pkey PRIMARY KEY (id);


--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (code);


--
-- Name: country_memberships country_memberships_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.country_memberships
    ADD CONSTRAINT country_memberships_pkey PRIMARY KEY (code);


--
-- Name: creator_attributions creator_attributions_order_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_attributions
    ADD CONSTRAINT creator_attributions_order_key UNIQUE (store_id, order_id);


--
-- Name: creator_attributions creator_attributions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_attributions
    ADD CONSTRAINT creator_attributions_pkey PRIMARY KEY (id);


--
-- Name: creator_commissions creator_commissions_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_commissions
    ADD CONSTRAINT creator_commissions_key UNIQUE (store_id, idempotency_key);


--
-- Name: creator_commissions creator_commissions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_commissions
    ADD CONSTRAINT creator_commissions_pkey PRIMARY KEY (id);


--
-- Name: creator_payouts creator_payouts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_payouts
    ADD CONSTRAINT creator_payouts_pkey PRIMARY KEY (id);


--
-- Name: creator_settings creator_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_settings
    ADD CONSTRAINT creator_settings_pkey PRIMARY KEY (store_id);


--
-- Name: creators creators_code_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creators
    ADD CONSTRAINT creators_code_key UNIQUE (store_id, code);


--
-- Name: creators creators_customer_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creators
    ADD CONSTRAINT creators_customer_key UNIQUE (store_id, customer_id);


--
-- Name: creators creators_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creators
    ADD CONSTRAINT creators_pkey PRIMARY KEY (id);


--
-- Name: creators creators_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creators
    ADD CONSTRAINT creators_store_id_key UNIQUE (store_id, id);


--
-- Name: credit_notes credit_notes_document_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_document_number_key UNIQUE (store_id, document_number);


--
-- Name: credit_notes credit_notes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_public_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_public_token_key UNIQUE (public_token);


--
-- Name: credit_notes credit_notes_refund_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_refund_key UNIQUE (store_id, refund_id);


--
-- Name: credit_notes credit_notes_series_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_series_number_key UNIQUE (store_id, series, number);


--
-- Name: crm_move_links crm_move_links_store_id_source_account_kind_external_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.crm_move_links
    ADD CONSTRAINT crm_move_links_store_id_source_account_kind_external_id_pk PRIMARY KEY (store_id, source, account, kind, external_id);


--
-- Name: crm_moves crm_moves_store_id_source_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.crm_moves
    ADD CONSTRAINT crm_moves_store_id_source_pk PRIMARY KEY (store_id, source);


--
-- Name: cron_jobs cron_jobs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cron_jobs
    ADD CONSTRAINT cron_jobs_pkey PRIMARY KEY (job);


--
-- Name: css_versions css_versions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.css_versions
    ADD CONSTRAINT css_versions_pkey PRIMARY KEY (id);


--
-- Name: custom_apps custom_apps_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.custom_apps
    ADD CONSTRAINT custom_apps_pkey PRIMARY KEY (id);


--
-- Name: custom_apps custom_apps_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.custom_apps
    ADD CONSTRAINT custom_apps_store_key UNIQUE (store_id, key);


--
-- Name: customer_addresses customer_addresses_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_addresses
    ADD CONSTRAINT customer_addresses_pkey PRIMARY KEY (id);


--
-- Name: customer_addresses customer_addresses_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_addresses
    ADD CONSTRAINT customer_addresses_store_id_key UNIQUE (store_id, id);


--
-- Name: customer_codes customer_codes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_codes
    ADD CONSTRAINT customer_codes_pkey PRIMARY KEY (id);


--
-- Name: customer_companies customer_companies_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_companies
    ADD CONSTRAINT customer_companies_pkey PRIMARY KEY (id);


--
-- Name: customer_companies customer_companies_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_companies
    ADD CONSTRAINT customer_companies_store_id_key UNIQUE (store_id, id);


--
-- Name: customer_notes customer_notes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_notes
    ADD CONSTRAINT customer_notes_pkey PRIMARY KEY (id);


--
-- Name: customer_notes customer_notes_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_notes
    ADD CONSTRAINT customer_notes_store_id_key UNIQUE (store_id, id);


--
-- Name: customer_sessions customer_sessions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_sessions
    ADD CONSTRAINT customer_sessions_pkey PRIMARY KEY (id);


--
-- Name: customer_sessions customer_sessions_token_hash_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_sessions
    ADD CONSTRAINT customer_sessions_token_hash_unique UNIQUE (token_hash);


--
-- Name: customer_sign_in_links customer_sign_in_links_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_sign_in_links
    ADD CONSTRAINT customer_sign_in_links_pkey PRIMARY KEY (id);


--
-- Name: customer_sign_in_links customer_sign_in_links_token_hash_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_sign_in_links
    ADD CONSTRAINT customer_sign_in_links_token_hash_unique UNIQUE (token_hash);


--
-- Name: customer_tags customer_tags_store_id_email_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_tags
    ADD CONSTRAINT customer_tags_store_id_email_key_pk PRIMARY KEY (store_id, email, key);


--
-- Name: customer_tiers customer_tiers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_tiers
    ADD CONSTRAINT customer_tiers_pkey PRIMARY KEY (id);


--
-- Name: customer_tiers customer_tiers_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_tiers
    ADD CONSTRAINT customer_tiers_store_id_key UNIQUE (store_id, id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_store_auth_user_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customers
    ADD CONSTRAINT customers_store_auth_user_key UNIQUE (store_id, auth_user_id);


--
-- Name: customers customers_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customers
    ADD CONSTRAINT customers_store_id_key UNIQUE (store_id, id);


--
-- Name: customs_settings customs_settings_store_id_market_code_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customs_settings
    ADD CONSTRAINT customs_settings_store_id_market_code_pk PRIMARY KEY (store_id, market_code);


--
-- Name: data_job_assets data_job_assets_job_id_source_url_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_job_assets
    ADD CONSTRAINT data_job_assets_job_id_source_url_pk PRIMARY KEY (job_id, source_url);


--
-- Name: data_job_items data_job_items_job_id_seq_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_job_items
    ADD CONSTRAINT data_job_items_job_id_seq_pk PRIMARY KEY (job_id, seq);


--
-- Name: data_jobs data_jobs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_jobs
    ADD CONSTRAINT data_jobs_pkey PRIMARY KEY (id);


--
-- Name: data_jobs data_jobs_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_jobs
    ADD CONSTRAINT data_jobs_store_id_key UNIQUE (store_id, id);


--
-- Name: deal_links deal_links_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_links
    ADD CONSTRAINT deal_links_pkey PRIMARY KEY (id);


--
-- Name: deal_moves deal_moves_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_moves
    ADD CONSTRAINT deal_moves_pkey PRIMARY KEY (id);


--
-- Name: deal_pipelines deal_pipelines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_pipelines
    ADD CONSTRAINT deal_pipelines_pkey PRIMARY KEY (id);


--
-- Name: deal_pipelines deal_pipelines_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_pipelines
    ADD CONSTRAINT deal_pipelines_store_id_key UNIQUE (store_id, id);


--
-- Name: deal_stages deal_stages_pipeline_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_stages
    ADD CONSTRAINT deal_stages_pipeline_key UNIQUE (store_id, pipeline_id, id);


--
-- Name: deal_stages deal_stages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_stages
    ADD CONSTRAINT deal_stages_pkey PRIMARY KEY (id);


--
-- Name: deal_stages deal_stages_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_stages
    ADD CONSTRAINT deal_stages_store_id_key UNIQUE (store_id, id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: deals deals_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_store_id_key UNIQUE (store_id, id);


--
-- Name: delivery_quotes delivery_quotes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.delivery_quotes
    ADD CONSTRAINT delivery_quotes_pkey PRIMARY KEY (id);


--
-- Name: delivery_quotes delivery_quotes_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.delivery_quotes
    ADD CONSTRAINT delivery_quotes_store_id_key UNIQUE (store_id, id);


--
-- Name: delivery_schedules delivery_schedules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.delivery_schedules
    ADD CONSTRAINT delivery_schedules_pkey PRIMARY KEY (id);


--
-- Name: delivery_schedules delivery_schedules_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.delivery_schedules
    ADD CONSTRAINT delivery_schedules_store_id_key UNIQUE (store_id, id);


--
-- Name: design_preset_uses design_preset_uses_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_pkey PRIMARY KEY (id);


--
-- Name: design_preset_versions design_preset_versions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_versions
    ADD CONSTRAINT design_preset_versions_pkey PRIMARY KEY (id);


--
-- Name: design_presets design_presets_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_presets
    ADD CONSTRAINT design_presets_pkey PRIMARY KEY (id);


--
-- Name: design_variations design_variations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_variations
    ADD CONSTRAINT design_variations_pkey PRIMARY KEY (id);


--
-- Name: developers developers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.developers
    ADD CONSTRAINT developers_pkey PRIMARY KEY (account_id);


--
-- Name: discount_code_items discount_code_items_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_code_items
    ADD CONSTRAINT discount_code_items_pkey PRIMARY KEY (id);


--
-- Name: discount_code_items discount_code_items_store_code_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_code_items
    ADD CONSTRAINT discount_code_items_store_code_key UNIQUE (store_id, code);


--
-- Name: discount_code_items discount_code_items_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_code_items
    ADD CONSTRAINT discount_code_items_store_id_key UNIQUE (store_id, id);


--
-- Name: discount_codes discount_codes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_codes
    ADD CONSTRAINT discount_codes_pkey PRIMARY KEY (id);


--
-- Name: discount_codes discount_codes_store_code_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_codes
    ADD CONSTRAINT discount_codes_store_code_key UNIQUE (store_id, code);


--
-- Name: discount_codes discount_codes_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_codes
    ADD CONSTRAINT discount_codes_store_id_key UNIQUE (store_id, id);


--
-- Name: dispute_evidence dispute_evidence_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dispute_evidence
    ADD CONSTRAINT dispute_evidence_pkey PRIMARY KEY (dispute_id);


--
-- Name: dns_changes dns_changes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_changes
    ADD CONSTRAINT dns_changes_pkey PRIMARY KEY (id);


--
-- Name: dns_zones dns_zones_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_zones
    ADD CONSTRAINT dns_zones_pkey PRIMARY KEY (id);


--
-- Name: docs_feedback docs_feedback_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_feedback
    ADD CONSTRAINT docs_feedback_pkey PRIMARY KEY (id);


--
-- Name: docs_guide_conversations docs_guide_conversations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_guide_conversations
    ADD CONSTRAINT docs_guide_conversations_pkey PRIMARY KEY (id);


--
-- Name: docs_guide_conversations docs_guide_conversations_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_guide_conversations
    ADD CONSTRAINT docs_guide_conversations_token_key UNIQUE (token_hash);


--
-- Name: docs_guide_messages docs_guide_messages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_guide_messages
    ADD CONSTRAINT docs_guide_messages_pkey PRIMARY KEY (id);


--
-- Name: docs_guide_messages docs_guide_messages_seq_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_guide_messages
    ADD CONSTRAINT docs_guide_messages_seq_key UNIQUE (conversation_id, seq);


--
-- Name: docs_guide docs_guide_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_guide
    ADD CONSTRAINT docs_guide_pkey PRIMARY KEY (id);


--
-- Name: docs_index docs_index_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_index
    ADD CONSTRAINT docs_index_key UNIQUE (key);


--
-- Name: docs_index docs_index_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_index
    ADD CONSTRAINT docs_index_pkey PRIMARY KEY (id);


--
-- Name: docs_index_state docs_index_state_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_index_state
    ADD CONSTRAINT docs_index_state_pkey PRIMARY KEY (id);


--
-- Name: docs_reads docs_reads_path_lang_day_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_reads
    ADD CONSTRAINT docs_reads_path_lang_day_pk PRIMARY KEY (path, lang, day);


--
-- Name: docs_search_misses docs_search_misses_query_lang_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_search_misses
    ADD CONSTRAINT docs_search_misses_query_lang_pk PRIMARY KEY (query, lang);


--
-- Name: document_deliveries document_deliveries_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_deliveries
    ADD CONSTRAINT document_deliveries_key UNIQUE (store_id, document_type, document_id, email_message_id);


--
-- Name: document_deliveries document_deliveries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_deliveries
    ADD CONSTRAINT document_deliveries_pkey PRIMARY KEY (id);


--
-- Name: document_pdf_state document_pdf_state_store_id_document_type_document_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_pdf_state
    ADD CONSTRAINT document_pdf_state_store_id_document_type_document_id_pk PRIMARY KEY (store_id, document_type, document_id);


--
-- Name: document_series document_series_store_id_series_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_series
    ADD CONSTRAINT document_series_store_id_series_pk PRIMARY KEY (store_id, series);


--
-- Name: domain_pricing domain_pricing_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_pricing
    ADD CONSTRAINT domain_pricing_pkey PRIMARY KEY (currency);


--
-- Name: domain_purchases domain_purchases_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_pkey PRIMARY KEY (id);


--
-- Name: domain_purchases domain_purchases_stripe_invoice_id_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_stripe_invoice_id_unique UNIQUE (stripe_invoice_id);


--
-- Name: domain_registrants domain_registrants_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrants
    ADD CONSTRAINT domain_registrants_pkey PRIMARY KEY (id);


--
-- Name: domain_registrations domain_registrations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrations
    ADD CONSTRAINT domain_registrations_pkey PRIMARY KEY (id);


--
-- Name: draft_order_lines draft_order_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_order_lines
    ADD CONSTRAINT draft_order_lines_pkey PRIMARY KEY (id);


--
-- Name: draft_orders draft_orders_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_pkey PRIMARY KEY (id);


--
-- Name: draft_orders draft_orders_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_store_id_key UNIQUE (store_id, id);


--
-- Name: draft_orders draft_orders_store_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_store_number_key UNIQUE (store_id, number);


--
-- Name: dream_runs dream_runs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dream_runs
    ADD CONSTRAINT dream_runs_pkey PRIMARY KEY (id);


--
-- Name: duty_rates duty_rates_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.duty_rates
    ADD CONSTRAINT duty_rates_pkey PRIMARY KEY (id);


--
-- Name: ecb_reference_rates ecb_reference_rates_rate_date_currency_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ecb_reference_rates
    ADD CONSTRAINT ecb_reference_rates_rate_date_currency_pk PRIMARY KEY (rate_date, currency);


--
-- Name: economic_operators economic_operators_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.economic_operators
    ADD CONSTRAINT economic_operators_pkey PRIMARY KEY (id);


--
-- Name: economic_operators economic_operators_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.economic_operators
    ADD CONSTRAINT economic_operators_store_id_key UNIQUE (store_id, id);


--
-- Name: einvoice_sends einvoice_sends_document_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.einvoice_sends
    ADD CONSTRAINT einvoice_sends_document_key UNIQUE (store_id, document_type, document_id);


--
-- Name: einvoice_sends einvoice_sends_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.einvoice_sends
    ADD CONSTRAINT einvoice_sends_pkey PRIMARY KEY (id);


--
-- Name: email_filing email_filing_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_filing
    ADD CONSTRAINT email_filing_pkey PRIMARY KEY (store_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);


--
-- Name: email_opt_outs email_opt_outs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_opt_outs
    ADD CONSTRAINT email_opt_outs_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_store_id_notification_locale_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_templates
    ADD CONSTRAINT email_templates_store_id_notification_locale_pk PRIMARY KEY (store_id, notification, locale);


--
-- Name: experiment_carts experiment_carts_store_id_cart_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_carts
    ADD CONSTRAINT experiment_carts_store_id_cart_id_pk PRIMARY KEY (store_id, cart_id);


--
-- Name: experiment_events experiment_events_once_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_events
    ADD CONSTRAINT experiment_events_once_key UNIQUE (experiment_id, visitor, goal, ref);


--
-- Name: experiment_events experiment_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_events
    ADD CONSTRAINT experiment_events_pkey PRIMARY KEY (id);


--
-- Name: experiment_exposures experiment_exposures_experiment_id_visitor_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_exposures
    ADD CONSTRAINT experiment_exposures_experiment_id_visitor_pk PRIMARY KEY (experiment_id, visitor);


--
-- Name: experiment_variants experiment_variants_experiment_id_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_variants
    ADD CONSTRAINT experiment_variants_experiment_id_key_pk PRIMARY KEY (experiment_id, key);


--
-- Name: experiments experiments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiments
    ADD CONSTRAINT experiments_pkey PRIMARY KEY (id);


--
-- Name: experiments experiments_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiments
    ADD CONSTRAINT experiments_store_id_key UNIQUE (store_id, id);


--
-- Name: feed_settings feed_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.feed_settings
    ADD CONSTRAINT feed_settings_pkey PRIMARY KEY (store_id);


--
-- Name: feed_settings feed_settings_token_hash; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.feed_settings
    ADD CONSTRAINT feed_settings_token_hash UNIQUE (token_hash);


--
-- Name: field_groups field_groups_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_groups
    ADD CONSTRAINT field_groups_pkey PRIMARY KEY (id);


--
-- Name: field_groups field_groups_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_groups
    ADD CONSTRAINT field_groups_store_id_key UNIQUE (store_id, id);


--
-- Name: field_groups field_groups_store_slug_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_groups
    ADD CONSTRAINT field_groups_store_slug_key UNIQUE (store_id, slug);


--
-- Name: field_search field_search_store_id_entity_entity_id_locale_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_search
    ADD CONSTRAINT field_search_store_id_entity_entity_id_locale_pk PRIMARY KEY (store_id, entity, entity_id, locale);


--
-- Name: field_values field_values_store_id_entity_entity_id_locale_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_values
    ADD CONSTRAINT field_values_store_id_entity_entity_id_locale_pk PRIMARY KEY (store_id, entity, entity_id, locale);


--
-- Name: fiken_connections fiken_connections_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.fiken_connections
    ADD CONSTRAINT fiken_connections_pkey PRIMARY KEY (store_id);


--
-- Name: fiken_sync fiken_sync_store_id_company_slug_kind_local_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.fiken_sync
    ADD CONSTRAINT fiken_sync_store_id_company_slug_kind_local_id_pk PRIMARY KEY (store_id, company_slug, kind, local_id);


--
-- Name: filed_emails filed_emails_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.filed_emails
    ADD CONSTRAINT filed_emails_pkey PRIMARY KEY (id);


--
-- Name: font_files font_files_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.font_files
    ADD CONSTRAINT font_files_pkey PRIMARY KEY (name);


--
-- Name: fonts fonts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.fonts
    ADD CONSTRAINT fonts_pkey PRIMARY KEY (family);


--
-- Name: fonts fonts_slug_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.fonts
    ADD CONSTRAINT fonts_slug_unique UNIQUE (slug);


--
-- Name: form_submissions form_submissions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.form_submissions
    ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (id);


--
-- Name: gift_card_entries gift_card_entries_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_card_entries
    ADD CONSTRAINT gift_card_entries_key UNIQUE (store_id, card_id, idempotency_key);


--
-- Name: gift_card_entries gift_card_entries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_card_entries
    ADD CONSTRAINT gift_card_entries_pkey PRIMARY KEY (id);


--
-- Name: gift_card_settings gift_card_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_card_settings
    ADD CONSTRAINT gift_card_settings_pkey PRIMARY KEY (store_id);


--
-- Name: gift_cards gift_cards_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_cards
    ADD CONSTRAINT gift_cards_pkey PRIMARY KEY (id);


--
-- Name: gift_cards gift_cards_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_cards
    ADD CONSTRAINT gift_cards_store_id_key UNIQUE (store_id, id);


--
-- Name: google_places google_places_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.google_places
    ADD CONSTRAINT google_places_pkey PRIMARY KEY (id);


--
-- Name: google_places google_places_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.google_places
    ADD CONSTRAINT google_places_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: host_commissions host_commissions_payment_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_commissions
    ADD CONSTRAINT host_commissions_payment_key UNIQUE (store_id, payment_id);


--
-- Name: host_commissions host_commissions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_commissions
    ADD CONSTRAINT host_commissions_pkey PRIMARY KEY (id);


--
-- Name: host_stripe_accounts host_stripe_accounts_account_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_stripe_accounts
    ADD CONSTRAINT host_stripe_accounts_account_key UNIQUE (mode, account_id);


--
-- Name: host_stripe_accounts host_stripe_accounts_host_id_mode_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_stripe_accounts
    ADD CONSTRAINT host_stripe_accounts_host_id_mode_pk PRIMARY KEY (host_id, mode);


--
-- Name: host_tax_details host_tax_details_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_tax_details
    ADD CONSTRAINT host_tax_details_pkey PRIMARY KEY (host_id);


--
-- Name: hosts hosts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.hosts
    ADD CONSTRAINT hosts_pkey PRIMARY KEY (id);


--
-- Name: hosts hosts_store_account_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.hosts
    ADD CONSTRAINT hosts_store_account_key UNIQUE (store_id, account_id);


--
-- Name: hosts hosts_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.hosts
    ADD CONSTRAINT hosts_store_id_key UNIQUE (store_id, id);


--
-- Name: house_customer_links house_customer_links_store_id_customer_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_customer_links
    ADD CONSTRAINT house_customer_links_store_id_customer_id_pk PRIMARY KEY (store_id, customer_id);


--
-- Name: house_site_copies house_site_copies_copy_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_site_copies
    ADD CONSTRAINT house_site_copies_copy_key UNIQUE (store_id, copy_id);


--
-- Name: house_site_copies house_site_copies_store_id_source_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_site_copies
    ADD CONSTRAINT house_site_copies_store_id_source_id_pk PRIMARY KEY (store_id, source_id);


--
-- Name: idempotency_keys idempotency_keys_store_id_scope_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.idempotency_keys
    ADD CONSTRAINT idempotency_keys_store_id_scope_key_pk PRIMARY KEY (store_id, scope, key);


--
-- Name: instagram_accounts instagram_accounts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.instagram_accounts
    ADD CONSTRAINT instagram_accounts_pkey PRIMARY KEY (id);


--
-- Name: instagram_accounts instagram_accounts_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.instagram_accounts
    ADD CONSTRAINT instagram_accounts_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: integration_deliveries integration_deliveries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.integration_deliveries
    ADD CONSTRAINT integration_deliveries_pkey PRIMARY KEY (id);


--
-- Name: inventory_levels inventory_levels_variant_id_location_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_levels
    ADD CONSTRAINT inventory_levels_variant_id_location_id_pk PRIMARY KEY (variant_id, location_id);


--
-- Name: inventory_locations inventory_locations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_locations
    ADD CONSTRAINT inventory_locations_pkey PRIMARY KEY (id);


--
-- Name: inventory_locations inventory_locations_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_locations
    ADD CONSTRAINT inventory_locations_store_id_key UNIQUE (store_id, id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: inventory_reservations inventory_reservations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);


--
-- Name: invoice_settings invoice_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoice_settings
    ADD CONSTRAINT invoice_settings_pkey PRIMARY KEY (store_id);


--
-- Name: invoices invoices_document_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_document_number_key UNIQUE (store_id, document_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_public_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_public_token_key UNIQUE (public_token);


--
-- Name: invoices invoices_series_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_series_number_key UNIQUE (store_id, series, number);


--
-- Name: invoices invoices_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_store_id_key UNIQUE (store_id, id);


--
-- Name: kaizen_life_accounts kaizen_life_accounts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.kaizen_life_accounts
    ADD CONSTRAINT kaizen_life_accounts_pkey PRIMARY KEY (id);


--
-- Name: kaizen_life_handoffs kaizen_life_handoffs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.kaizen_life_handoffs
    ADD CONSTRAINT kaizen_life_handoffs_pkey PRIMARY KEY (id);


--
-- Name: kaizen_life_jtis kaizen_life_jtis_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.kaizen_life_jtis
    ADD CONSTRAINT kaizen_life_jtis_pkey PRIMARY KEY (jti);


--
-- Name: knowledge_chunks knowledge_chunks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id);


--
-- Name: knowledge_documents knowledge_documents_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_documents
    ADD CONSTRAINT knowledge_documents_pkey PRIMARY KEY (id);


--
-- Name: lead_decisions lead_decisions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.lead_decisions
    ADD CONSTRAINT lead_decisions_pkey PRIMARY KEY (id);


--
-- Name: ledger_accounts ledger_accounts_book_id_number_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_accounts
    ADD CONSTRAINT ledger_accounts_book_id_number_pk PRIMARY KEY (book_id, number);


--
-- Name: ledger_books ledger_books_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_books
    ADD CONSTRAINT ledger_books_pkey PRIMARY KEY (id);


--
-- Name: ledger_books ledger_books_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_books
    ADD CONSTRAINT ledger_books_store_id_key UNIQUE (store_id, id);


--
-- Name: ledger_budgets ledger_budgets_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_budgets
    ADD CONSTRAINT ledger_budgets_pkey PRIMARY KEY (id);


--
-- Name: ledger_comparisons ledger_comparisons_book_id_source_kind_source_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_comparisons
    ADD CONSTRAINT ledger_comparisons_book_id_source_kind_source_id_pk PRIMARY KEY (book_id, source_kind, source_id);


--
-- Name: ledger_counters ledger_counters_book_id_series_year_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_counters
    ADD CONSTRAINT ledger_counters_book_id_series_year_pk PRIMARY KEY (book_id, series, year);


--
-- Name: ledger_entries ledger_entries_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_entries
    ADD CONSTRAINT ledger_entries_number_key UNIQUE (book_id, series, year, number);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_entries
    ADD CONSTRAINT ledger_entries_store_id_key UNIQUE (store_id, id);


--
-- Name: ledger_lines ledger_lines_entry_id_line_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_lines
    ADD CONSTRAINT ledger_lines_entry_id_line_pk PRIMARY KEY (entry_id, line);


--
-- Name: ledger_vouchers ledger_vouchers_file_path_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_file_path_key UNIQUE (file_path);


--
-- Name: ledger_vouchers ledger_vouchers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_pkey PRIMARY KEY (id);


--
-- Name: ledger_vouchers ledger_vouchers_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_store_id_key UNIQUE (store_id, id);


--
-- Name: ledger_waiting ledger_waiting_book_id_source_kind_source_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_waiting
    ADD CONSTRAINT ledger_waiting_book_id_source_kind_source_id_pk PRIMARY KEY (book_id, source_kind, source_id);


--
-- Name: legal_ai_settings legal_ai_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_ai_settings
    ADD CONSTRAINT legal_ai_settings_pkey PRIMARY KEY (store_id);


--
-- Name: legal_ai_writes legal_ai_writes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_ai_writes
    ADD CONSTRAINT legal_ai_writes_pkey PRIMARY KEY (id);


--
-- Name: legal_snapshots legal_snapshots_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_snapshots
    ADD CONSTRAINT legal_snapshots_pkey PRIMARY KEY (id);


--
-- Name: legal_snapshots legal_snapshots_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_snapshots
    ADD CONSTRAINT legal_snapshots_store_id_key UNIQUE (store_id, id);


--
-- Name: legal_snapshots legal_snapshots_text_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_snapshots
    ADD CONSTRAINT legal_snapshots_text_key UNIQUE (store_id, role, locale, content_hash);


--
-- Name: legal_source_reads legal_source_reads_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_source_reads
    ADD CONSTRAINT legal_source_reads_pkey PRIMARY KEY (id);


--
-- Name: legal_source_texts legal_source_texts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_source_texts
    ADD CONSTRAINT legal_source_texts_pkey PRIMARY KEY (hash);


--
-- Name: limit_overrides limit_overrides_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.limit_overrides
    ADD CONSTRAINT limit_overrides_key UNIQUE NULLS NOT DISTINCT (store_id, account_id, key);


--
-- Name: limit_overrides limit_overrides_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.limit_overrides
    ADD CONSTRAINT limit_overrides_pkey PRIMARY KEY (id);


--
-- Name: live_drills live_drills_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.live_drills
    ADD CONSTRAINT live_drills_pkey PRIMARY KEY (id);


--
-- Name: local_delivery_areas local_delivery_areas_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.local_delivery_areas
    ADD CONSTRAINT local_delivery_areas_pkey PRIMARY KEY (id);


--
-- Name: local_delivery_areas local_delivery_areas_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.local_delivery_areas
    ADD CONSTRAINT local_delivery_areas_store_id_key UNIQUE (store_id, id);


--
-- Name: look_versions look_versions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.look_versions
    ADD CONSTRAINT look_versions_pkey PRIMARY KEY (id);


--
-- Name: market_availability market_availability_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_availability
    ADD CONSTRAINT market_availability_key UNIQUE NULLS NOT DISTINCT (product_id, variant_id, market_code);


--
-- Name: market_availability market_availability_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_availability
    ADD CONSTRAINT market_availability_pkey PRIMARY KEY (id);


--
-- Name: market_price_rules market_price_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_price_rules
    ADD CONSTRAINT market_price_rules_pkey PRIMARY KEY (store_id, market_code);


--
-- Name: marketing_consent_events marketing_consent_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_consent_events
    ADD CONSTRAINT marketing_consent_events_pkey PRIMARY KEY (id);


--
-- Name: marketing_spend marketing_spend_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_spend
    ADD CONSTRAINT marketing_spend_key UNIQUE (store_id, day, channel, campaign);


--
-- Name: marketing_spend marketing_spend_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_spend
    ADD CONSTRAINT marketing_spend_pkey PRIMARY KEY (id);


--
-- Name: marketing_subscribers marketing_subscribers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_subscribers
    ADD CONSTRAINT marketing_subscribers_pkey PRIMARY KEY (id);


--
-- Name: marketing_subscribers marketing_subscribers_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_subscribers
    ADD CONSTRAINT marketing_subscribers_store_id_key UNIQUE (store_id, id);


--
-- Name: marketplace_connections marketplace_connections_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_connections
    ADD CONSTRAINT marketplace_connections_pkey PRIMARY KEY (id);


--
-- Name: marketplace_connections marketplace_connections_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_connections
    ADD CONSTRAINT marketplace_connections_store_id_key UNIQUE (store_id, id);


--
-- Name: marketplace_listings marketplace_listings_connection_id_variant_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_listings
    ADD CONSTRAINT marketplace_listings_connection_id_variant_id_pk PRIMARY KEY (connection_id, variant_id);


--
-- Name: marketplace_orders marketplace_orders_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_orders
    ADD CONSTRAINT marketplace_orders_pkey PRIMARY KEY (id);


--
-- Name: marketplace_orders marketplace_orders_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_orders
    ADD CONSTRAINT marketplace_orders_store_id_key UNIQUE (store_id, id);


--
-- Name: markets markets_store_code_currency_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.markets
    ADD CONSTRAINT markets_store_code_currency_key UNIQUE (store_id, code, currency);


--
-- Name: markets markets_store_id_code_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.markets
    ADD CONSTRAINT markets_store_id_code_pk PRIMARY KEY (store_id, code);


--
-- Name: media_embeddings media_embeddings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media_embeddings
    ADD CONSTRAINT media_embeddings_pkey PRIMARY KEY (media_id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: media media_url_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media
    ADD CONSTRAINT media_url_key UNIQUE (url);


--
-- Name: menus menus_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.menus
    ADD CONSTRAINT menus_pkey PRIMARY KEY (id);


--
-- Name: menus menus_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.menus
    ADD CONSTRAINT menus_store_id_key UNIQUE (store_id, id);


--
-- Name: menus menus_store_name_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.menus
    ADD CONSTRAINT menus_store_name_key UNIQUE NULLS NOT DISTINCT (store_id, name);


--
-- Name: mollie_connections mollie_connections_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.mollie_connections
    ADD CONSTRAINT mollie_connections_pkey PRIMARY KEY (store_id);


--
-- Name: not_found_hits not_found_hits_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.not_found_hits
    ADD CONSTRAINT not_found_hits_key UNIQUE NULLS NOT DISTINCT (store_id, day, path);


--
-- Name: not_found_ignored not_found_ignored_store_id_path_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.not_found_ignored
    ADD CONSTRAINT not_found_ignored_store_id_path_pk PRIMARY KEY (store_id, path);


--
-- Name: notification_settings notification_settings_store_id_notification_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.notification_settings
    ADD CONSTRAINT notification_settings_store_id_notification_pk PRIMARY KEY (store_id, notification);


--
-- Name: oauth_clients oauth_clients_client_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_clients
    ADD CONSTRAINT oauth_clients_client_id_key UNIQUE (client_id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_grants oauth_grants_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_grants
    ADD CONSTRAINT oauth_grants_pkey PRIMARY KEY (id);


--
-- Name: oauth_store_cutoffs oauth_store_cutoffs_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_store_cutoffs
    ADD CONSTRAINT oauth_store_cutoffs_key UNIQUE (store_id, account_id, client_id);


--
-- Name: oauth_store_cutoffs oauth_store_cutoffs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_store_cutoffs
    ADD CONSTRAINT oauth_store_cutoffs_pkey PRIMARY KEY (id);


--
-- Name: oauth_tokens oauth_tokens_hash_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_tokens
    ADD CONSTRAINT oauth_tokens_hash_key UNIQUE (token_hash);


--
-- Name: oauth_tokens oauth_tokens_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_tokens
    ADD CONSTRAINT oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: old_shops old_shops_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.old_shops
    ADD CONSTRAINT old_shops_pkey PRIMARY KEY (store_id);


--
-- Name: order_discount_codes order_discount_codes_order_id_position_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_discount_codes
    ADD CONSTRAINT order_discount_codes_order_id_position_pk PRIMARY KEY (order_id, "position");


--
-- Name: order_downloads order_downloads_order_file_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_downloads
    ADD CONSTRAINT order_downloads_order_file_key UNIQUE (order_id, file_id);


--
-- Name: order_downloads order_downloads_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_downloads
    ADD CONSTRAINT order_downloads_pkey PRIMARY KEY (id);


--
-- Name: order_downloads order_downloads_token_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_downloads
    ADD CONSTRAINT order_downloads_token_unique UNIQUE (token);


--
-- Name: order_edit_lines order_edit_lines_order_edit_id_n_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edit_lines
    ADD CONSTRAINT order_edit_lines_order_edit_id_n_pk PRIMARY KEY (order_edit_id, n);


--
-- Name: order_edits order_edits_order_seq_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edits
    ADD CONSTRAINT order_edits_order_seq_key UNIQUE (store_id, order_id, seq);


--
-- Name: order_edits order_edits_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edits
    ADD CONSTRAINT order_edits_pkey PRIMARY KEY (id);


--
-- Name: order_edits order_edits_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edits
    ADD CONSTRAINT order_edits_store_id_key UNIQUE (store_id, id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_line_components order_line_components_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_line_components
    ADD CONSTRAINT order_line_components_pkey PRIMARY KEY (order_line_id, variant_id);


--
-- Name: order_lines order_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_lines
    ADD CONSTRAINT order_lines_pkey PRIMARY KEY (id);


--
-- Name: order_lines order_lines_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_lines
    ADD CONSTRAINT order_lines_store_id_key UNIQUE (store_id, id);


--
-- Name: order_payment_terms order_payment_terms_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_payment_terms
    ADD CONSTRAINT order_payment_terms_pkey PRIMARY KEY (order_id);


--
-- Name: order_rule_runs order_rule_runs_once_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rule_runs
    ADD CONSTRAINT order_rule_runs_once_key UNIQUE (rule_id, event_id);


--
-- Name: order_rule_runs order_rule_runs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rule_runs
    ADD CONSTRAINT order_rule_runs_pkey PRIMARY KEY (id);


--
-- Name: order_rules order_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rules
    ADD CONSTRAINT order_rules_pkey PRIMARY KEY (id);


--
-- Name: order_rules order_rules_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rules
    ADD CONSTRAINT order_rules_store_id_key UNIQUE (store_id, id);


--
-- Name: order_settings order_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_settings
    ADD CONSTRAINT order_settings_pkey PRIMARY KEY (store_id);


--
-- Name: order_tags order_tags_order_id_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_tags
    ADD CONSTRAINT order_tags_order_id_key_pk PRIMARY KEY (order_id, key);


--
-- Name: order_terms order_terms_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_terms
    ADD CONSTRAINT order_terms_pkey PRIMARY KEY (order_id);


--
-- Name: order_views order_views_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_views
    ADD CONSTRAINT order_views_pkey PRIMARY KEY (id);


--
-- Name: order_views order_views_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_views
    ADD CONSTRAINT order_views_store_id_key UNIQUE (store_id, id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: orders orders_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_store_id_key UNIQUE (store_id, id);


--
-- Name: orders orders_store_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_store_number_key UNIQUE (store_id, number);


--
-- Name: own_speed_samples own_speed_samples_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.own_speed_samples
    ADD CONSTRAINT own_speed_samples_pkey PRIMARY KEY (id);


--
-- Name: page_ai_jobs page_ai_jobs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_ai_jobs
    ADD CONSTRAINT page_ai_jobs_pkey PRIMARY KEY (id);


--
-- Name: page_looks page_looks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_looks
    ADD CONSTRAINT page_looks_pkey PRIMARY KEY (id);


--
-- Name: page_redirects page_redirects_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_redirects
    ADD CONSTRAINT page_redirects_pkey PRIMARY KEY (id);


--
-- Name: page_redirects page_redirects_store_slug_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_redirects
    ADD CONSTRAINT page_redirects_store_slug_key UNIQUE NULLS NOT DISTINCT (store_id, type, slug);


--
-- Name: page_replications page_replications_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_replications
    ADD CONSTRAINT page_replications_pkey PRIMARY KEY (id);


--
-- Name: page_roles page_roles_store_id_role_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_roles
    ADD CONSTRAINT page_roles_store_id_role_pk PRIMARY KEY (store_id, role);


--
-- Name: page_roles page_roles_store_page_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_roles
    ADD CONSTRAINT page_roles_store_page_key UNIQUE (store_id, page_id);


--
-- Name: page_schedules page_schedules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_schedules
    ADD CONSTRAINT page_schedules_pkey PRIMARY KEY (id);


--
-- Name: page_theme_detaches page_theme_detaches_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_theme_detaches
    ADD CONSTRAINT page_theme_detaches_pkey PRIMARY KEY (id);


--
-- Name: page_versions page_versions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_versions
    ADD CONSTRAINT page_versions_pkey PRIMARY KEY (id);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: pages pages_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pages
    ADD CONSTRAINT pages_store_id_key UNIQUE (store_id, id);


--
-- Name: pages pages_store_slug_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pages
    ADD CONSTRAINT pages_store_slug_key UNIQUE NULLS NOT DISTINCT (store_id, type, slug);


--
-- Name: payment_credentials payment_credentials_store_id_provider_mode_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_credentials
    ADD CONSTRAINT payment_credentials_store_id_provider_mode_pk PRIMARY KEY (store_id, provider, mode);


--
-- Name: payment_disputes payment_disputes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_disputes
    ADD CONSTRAINT payment_disputes_pkey PRIMARY KEY (id);


--
-- Name: payment_disputes payment_disputes_reference_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_disputes
    ADD CONSTRAINT payment_disputes_reference_key UNIQUE (store_id, provider, provider_reference);


--
-- Name: payment_disputes payment_disputes_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_disputes
    ADD CONSTRAINT payment_disputes_store_id_key UNIQUE (store_id, id);


--
-- Name: payment_methods payment_methods_store_id_market_code_method_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_methods
    ADD CONSTRAINT payment_methods_store_id_market_code_method_pk PRIMARY KEY (store_id, market_code, method);


--
-- Name: payment_providers payment_providers_store_id_provider_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_providers
    ADD CONSTRAINT payment_providers_store_id_provider_pk PRIMARY KEY (store_id, provider);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_provider_reference_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_provider_reference_key UNIQUE (store_id, provider, provider_reference);


--
-- Name: payments payments_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_store_id_key UNIQUE (store_id, id);


--
-- Name: payout_lines payout_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_lines
    ADD CONSTRAINT payout_lines_pkey PRIMARY KEY (id);


--
-- Name: payout_lines payout_lines_reference_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_lines
    ADD CONSTRAINT payout_lines_reference_key UNIQUE (store_id, payout_id, provider_reference);


--
-- Name: payout_reads payout_reads_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_reads
    ADD CONSTRAINT payout_reads_pkey PRIMARY KEY (store_id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_reference_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payouts
    ADD CONSTRAINT payouts_reference_key UNIQUE (store_id, provider, provider_reference);


--
-- Name: payouts payouts_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payouts
    ADD CONSTRAINT payouts_store_id_key UNIQUE (store_id, id);


--
-- Name: peppol_receivers peppol_receivers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.peppol_receivers
    ADD CONSTRAINT peppol_receivers_pkey PRIMARY KEY (participant);


--
-- Name: pickup_options pickup_options_location_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pickup_options
    ADD CONSTRAINT pickup_options_location_key UNIQUE (store_id, location_id);


--
-- Name: pickup_options pickup_options_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pickup_options
    ADD CONSTRAINT pickup_options_pkey PRIMARY KEY (id);


--
-- Name: pickup_options pickup_options_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pickup_options
    ADD CONSTRAINT pickup_options_store_id_key UNIQUE (store_id, id);


--
-- Name: plan_feature_grants plan_feature_grants_feature_id_plan_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_feature_grants
    ADD CONSTRAINT plan_feature_grants_feature_id_plan_id_pk PRIMARY KEY (feature_id, plan_id);


--
-- Name: plan_features plan_features_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_features
    ADD CONSTRAINT plan_features_pkey PRIMARY KEY (id);


--
-- Name: plan_limits plan_limits_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_limits
    ADD CONSTRAINT plan_limits_key UNIQUE NULLS NOT DISTINCT (plan_id, key);


--
-- Name: plan_limits plan_limits_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_limits
    ADD CONSTRAINT plan_limits_pkey PRIMARY KEY (id);


--
-- Name: plan_moves plan_moves_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_moves
    ADD CONSTRAINT plan_moves_pkey PRIMARY KEY (id);


--
-- Name: plan_prices plan_prices_id_plan_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_prices
    ADD CONSTRAINT plan_prices_id_plan_key UNIQUE (id, plan_id);


--
-- Name: plan_prices plan_prices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_prices
    ADD CONSTRAINT plan_prices_pkey PRIMARY KEY (id);


--
-- Name: plan_reminder_steps plan_reminder_steps_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_reminder_steps
    ADD CONSTRAINT plan_reminder_steps_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: platform_ad_conversions platform_ad_conversions_once; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_ad_conversions
    ADD CONSTRAINT platform_ad_conversions_once UNIQUE (request_id, platform, event);


--
-- Name: platform_ad_conversions platform_ad_conversions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_ad_conversions
    ADD CONSTRAINT platform_ad_conversions_pkey PRIMARY KEY (id);


--
-- Name: platform_api_tokens platform_api_tokens_hash_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_api_tokens
    ADD CONSTRAINT platform_api_tokens_hash_key UNIQUE (token_hash);


--
-- Name: platform_api_tokens platform_api_tokens_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_api_tokens
    ADD CONSTRAINT platform_api_tokens_pkey PRIMARY KEY (id);


--
-- Name: platform_discount_codes platform_discount_codes_code_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_discount_codes
    ADD CONSTRAINT platform_discount_codes_code_unique UNIQUE (code);


--
-- Name: platform_discount_codes platform_discount_codes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_discount_codes
    ADD CONSTRAINT platform_discount_codes_pkey PRIMARY KEY (id);


--
-- Name: platform_integration_deliveries platform_integration_deliveries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_integration_deliveries
    ADD CONSTRAINT platform_integration_deliveries_pkey PRIMARY KEY (id);


--
-- Name: platform_integrations platform_integrations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_integrations
    ADD CONSTRAINT platform_integrations_pkey PRIMARY KEY (provider);


--
-- Name: platform_languages platform_languages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_languages
    ADD CONSTRAINT platform_languages_pkey PRIMARY KEY (lang);


--
-- Name: platform_marketing_spend platform_marketing_spend_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_marketing_spend
    ADD CONSTRAINT platform_marketing_spend_key UNIQUE (day, channel, campaign, currency);


--
-- Name: platform_marketing_spend platform_marketing_spend_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_marketing_spend
    ADD CONSTRAINT platform_marketing_spend_pkey PRIMARY KEY (id);


--
-- Name: platform_page_roles platform_page_roles_page_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_page_roles
    ADD CONSTRAINT platform_page_roles_page_key UNIQUE (page_id);


--
-- Name: platform_page_roles platform_page_roles_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_page_roles
    ADD CONSTRAINT platform_page_roles_pkey PRIMARY KEY (role);


--
-- Name: platform_payout_lines platform_payout_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_payout_lines
    ADD CONSTRAINT platform_payout_lines_pkey PRIMARY KEY (id);


--
-- Name: platform_payouts platform_payouts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_payouts
    ADD CONSTRAINT platform_payouts_pkey PRIMARY KEY (id);


--
-- Name: platform_sales platform_sales_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_sales
    ADD CONSTRAINT platform_sales_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: platform_targets platform_targets_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_targets
    ADD CONSTRAINT platform_targets_pkey PRIMARY KEY (id);


--
-- Name: platform_theme_install_updates platform_theme_install_updates_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_install_updates
    ADD CONSTRAINT platform_theme_install_updates_pkey PRIMARY KEY (id);


--
-- Name: platform_theme_installs platform_theme_installs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_installs
    ADD CONSTRAINT platform_theme_installs_pkey PRIMARY KEY (id);


--
-- Name: platform_webhook_endpoints platform_webhook_endpoints_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_webhook_endpoints
    ADD CONSTRAINT platform_webhook_endpoints_pkey PRIMARY KEY (id);


--
-- Name: platform_webhooks platform_webhooks_provider_mode_kind_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_webhooks
    ADD CONSTRAINT platform_webhooks_provider_mode_kind_pk PRIMARY KEY (provider, mode, kind);


--
-- Name: platform_workflow_runs platform_workflow_runs_once_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_workflow_runs
    ADD CONSTRAINT platform_workflow_runs_once_key UNIQUE (workflow_id, event_key);


--
-- Name: platform_workflow_runs platform_workflow_runs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_workflow_runs
    ADD CONSTRAINT platform_workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: platform_workflows platform_workflows_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_workflows
    ADD CONSTRAINT platform_workflows_pkey PRIMARY KEY (id);


--
-- Name: postal_points postal_points_country_postal_code_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.postal_points
    ADD CONSTRAINT postal_points_country_postal_code_pk PRIMARY KEY (country, postal_code);


--
-- Name: preview_links preview_links_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.preview_links
    ADD CONSTRAINT preview_links_pkey PRIMARY KEY (id);


--
-- Name: price_breaks price_breaks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_breaks
    ADD CONSTRAINT price_breaks_pkey PRIMARY KEY (id);


--
-- Name: price_breaks price_breaks_step_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_breaks
    ADD CONSTRAINT price_breaks_step_key UNIQUE NULLS NOT DISTINCT (product_id, variant_id, from_quantity);


--
-- Name: price_breaks price_breaks_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_breaks
    ADD CONSTRAINT price_breaks_store_id_key UNIQUE (store_id, id);


--
-- Name: price_list_assignments price_list_assignments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_assignments
    ADD CONSTRAINT price_list_assignments_pkey PRIMARY KEY (id);


--
-- Name: price_list_breaks price_list_breaks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_breaks
    ADD CONSTRAINT price_list_breaks_pkey PRIMARY KEY (id);


--
-- Name: price_list_breaks price_list_breaks_step_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_breaks
    ADD CONSTRAINT price_list_breaks_step_key UNIQUE (list_id, variant_id, from_quantity);


--
-- Name: price_list_prices price_list_prices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_prices
    ADD CONSTRAINT price_list_prices_pkey PRIMARY KEY (list_id, variant_id, currency);


--
-- Name: price_list_products price_list_products_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_products
    ADD CONSTRAINT price_list_products_pkey PRIMARY KEY (id);


--
-- Name: price_list_quantity_rules price_list_quantity_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_quantity_rules
    ADD CONSTRAINT price_list_quantity_rules_pkey PRIMARY KEY (list_id, variant_id);


--
-- Name: price_lists price_lists_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_lists
    ADD CONSTRAINT price_lists_pkey PRIMARY KEY (id);


--
-- Name: price_lists price_lists_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_lists
    ADD CONSTRAINT price_lists_store_id_key UNIQUE (store_id, id);


--
-- Name: prices prices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.prices
    ADD CONSTRAINT prices_pkey PRIMARY KEY (id);


--
-- Name: privacy_requests privacy_requests_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.privacy_requests
    ADD CONSTRAINT privacy_requests_pkey PRIMARY KEY (id);


--
-- Name: producer_registrations producer_registrations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.producer_registrations
    ADD CONSTRAINT producer_registrations_pkey PRIMARY KEY (id);


--
-- Name: product_embeddings product_embeddings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_embeddings
    ADD CONSTRAINT product_embeddings_pkey PRIMARY KEY (product_id, locale);


--
-- Name: product_files product_files_path_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_files
    ADD CONSTRAINT product_files_path_key UNIQUE (path);


--
-- Name: product_files product_files_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_files
    ADD CONSTRAINT product_files_pkey PRIMARY KEY (id);


--
-- Name: product_files product_files_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_files
    ADD CONSTRAINT product_files_store_id_key UNIQUE (store_id, id);


--
-- Name: product_groups product_groups_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_groups
    ADD CONSTRAINT product_groups_pkey PRIMARY KEY (id);


--
-- Name: product_groups product_groups_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_groups
    ADD CONSTRAINT product_groups_store_id_key UNIQUE (store_id, id);


--
-- Name: product_market_texts product_market_texts_product_id_market_code_locale_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_market_texts
    ADD CONSTRAINT product_market_texts_product_id_market_code_locale_pk PRIMARY KEY (product_id, market_code, locale);


--
-- Name: product_media product_media_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_media
    ADD CONSTRAINT product_media_pkey PRIMARY KEY (id);


--
-- Name: product_passports product_passports_store_id_product_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_passports
    ADD CONSTRAINT product_passports_store_id_product_id_pk PRIMARY KEY (store_id, product_id);


--
-- Name: product_resources product_resources_product_id_resource_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_resources
    ADD CONSTRAINT product_resources_product_id_resource_id_pk PRIMARY KEY (product_id, resource_id);


--
-- Name: product_reviews product_reviews_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_pkey PRIMARY KEY (id);


--
-- Name: product_reviews product_reviews_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_store_id_key UNIQUE (store_id, id);


--
-- Name: product_safety_rules product_safety_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_safety_rules
    ADD CONSTRAINT product_safety_rules_pkey PRIMARY KEY (destination);


--
-- Name: product_schemes product_schemes_product_id_scheme_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_schemes
    ADD CONSTRAINT product_schemes_product_id_scheme_pk PRIMARY KEY (product_id, scheme);


--
-- Name: product_settings product_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_settings
    ADD CONSTRAINT product_settings_pkey PRIMARY KEY (store_id);


--
-- Name: product_terms product_terms_product_id_term_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_terms
    ADD CONSTRAINT product_terms_product_id_term_id_pk PRIMARY KEY (product_id, term_id);


--
-- Name: product_translations product_translations_product_id_locale_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_translations
    ADD CONSTRAINT product_translations_product_id_locale_pk PRIMARY KEY (product_id, locale);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_variants
    ADD CONSTRAINT product_variants_store_id_key UNIQUE (store_id, id);


--
-- Name: product_variants product_variants_store_sku_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_variants
    ADD CONSTRAINT product_variants_store_sku_key UNIQUE (store_id, sku);


--
-- Name: product_views product_views_store_id_day_product_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_views
    ADD CONSTRAINT product_views_store_id_day_product_id_pk PRIMARY KEY (store_id, day, product_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_store_handle_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_store_handle_key UNIQUE (store_id, handle);


--
-- Name: products products_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_store_id_key UNIQUE (store_id, id);


--
-- Name: purchase_order_lines purchase_order_lines_purchase_order_id_variant_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_purchase_order_id_variant_id_pk PRIMARY KEY (purchase_order_id, variant_id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.purchase_orders
    ADD CONSTRAINT purchase_orders_store_id_key UNIQUE (store_id, id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_store_key UNIQUE (endpoint, store_id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: recommendation_adds recommendation_adds_cart_product_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_adds
    ADD CONSTRAINT recommendation_adds_cart_product_key UNIQUE (store_id, cart_id, product_id);


--
-- Name: recommendation_adds recommendation_adds_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_adds
    ADD CONSTRAINT recommendation_adds_pkey PRIMARY KEY (id);


--
-- Name: recommendation_events recommendation_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_events
    ADD CONSTRAINT recommendation_events_pkey PRIMARY KEY (id);


--
-- Name: recommendation_rules recommendation_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_rules
    ADD CONSTRAINT recommendation_rules_pkey PRIMARY KEY (id);


--
-- Name: recommendation_rules recommendation_rules_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_rules
    ADD CONSTRAINT recommendation_rules_store_id_key UNIQUE (store_id, id);


--
-- Name: recommendation_settings recommendation_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_settings
    ADD CONSTRAINT recommendation_settings_pkey PRIMARY KEY (store_id);


--
-- Name: recurring_costs recurring_costs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recurring_costs
    ADD CONSTRAINT recurring_costs_pkey PRIMARY KEY (id);


--
-- Name: recurring_costs recurring_costs_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recurring_costs
    ADD CONSTRAINT recurring_costs_store_id_key UNIQUE (store_id, id);


--
-- Name: redirects redirects_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_pkey PRIMARY KEY (id);


--
-- Name: redirects redirects_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_store_id_key UNIQUE (store_id, id);


--
-- Name: redirects redirects_store_source_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_store_source_key UNIQUE (store_id, source);


--
-- Name: referral_allocations referral_allocations_lot_id_entry_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_allocations
    ADD CONSTRAINT referral_allocations_lot_id_entry_id_pk PRIMARY KEY (lot_id, entry_id);


--
-- Name: referral_entries referral_entries_idempotency_key_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_entries
    ADD CONSTRAINT referral_entries_idempotency_key_unique UNIQUE (idempotency_key);


--
-- Name: referral_entries referral_entries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_entries
    ADD CONSTRAINT referral_entries_pkey PRIMARY KEY (id);


--
-- Name: referral_settings referral_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_settings
    ADD CONSTRAINT referral_settings_pkey PRIMARY KEY (id);


--
-- Name: referral_visits referral_visits_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_visits
    ADD CONSTRAINT referral_visits_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_store_id_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrals
    ADD CONSTRAINT referrals_store_id_unique UNIQUE (store_id);


--
-- Name: referrers referrers_code_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrers
    ADD CONSTRAINT referrers_code_unique UNIQUE (code);


--
-- Name: referrers referrers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrers
    ADD CONSTRAINT referrers_pkey PRIMARY KEY (account_id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_provider_reference_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_provider_reference_key UNIQUE (store_id, provider_reference);


--
-- Name: refunds refunds_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_store_id_key UNIQUE (store_id, id);


--
-- Name: report_schedules report_schedules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.report_schedules
    ADD CONSTRAINT report_schedules_pkey PRIMARY KEY (id);


--
-- Name: research_notes research_notes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.research_notes
    ADD CONSTRAINT research_notes_pkey PRIMARY KEY (id);


--
-- Name: research_sources research_sources_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.research_sources
    ADD CONSTRAINT research_sources_pkey PRIMARY KEY (id);


--
-- Name: resource_blocks resource_blocks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.resource_blocks
    ADD CONSTRAINT resource_blocks_pkey PRIMARY KEY (id);


--
-- Name: retention_rules retention_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.retention_rules
    ADD CONSTRAINT retention_rules_pkey PRIMARY KEY (id);


--
-- Name: return_exchange_lines return_exchange_lines_exchange_id_n_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchange_lines
    ADD CONSTRAINT return_exchange_lines_exchange_id_n_pk PRIMARY KEY (exchange_id, n);


--
-- Name: return_exchanges return_exchanges_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_pkey PRIMARY KEY (id);


--
-- Name: return_exchanges return_exchanges_return_seq_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_return_seq_key UNIQUE (store_id, return_id, seq);


--
-- Name: return_exchanges return_exchanges_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_store_id_key UNIQUE (store_id, id);


--
-- Name: return_lines return_lines_return_id_order_line_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_lines
    ADD CONSTRAINT return_lines_return_id_order_line_id_pk PRIMARY KEY (return_id, order_line_id);


--
-- Name: return_settings return_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_settings
    ADD CONSTRAINT return_settings_pkey PRIMARY KEY (store_id);


--
-- Name: returns returns_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id);


--
-- Name: returns returns_public_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.returns
    ADD CONSTRAINT returns_public_token_key UNIQUE (public_token);


--
-- Name: returns returns_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.returns
    ADD CONSTRAINT returns_store_id_key UNIQUE (store_id, id);


--
-- Name: returns returns_store_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.returns
    ADD CONSTRAINT returns_store_number_key UNIQUE (store_id, number);


--
-- Name: review_pictures review_pictures_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_pictures
    ADD CONSTRAINT review_pictures_pkey PRIMARY KEY (id);


--
-- Name: review_pictures review_pictures_position_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_pictures
    ADD CONSTRAINT review_pictures_position_key UNIQUE (store_id, review_id, "position");


--
-- Name: review_pictures review_pictures_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_pictures
    ADD CONSTRAINT review_pictures_store_id_key UNIQUE (store_id, id);


--
-- Name: review_requests review_requests_store_id_order_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_requests
    ADD CONSTRAINT review_requests_store_id_order_id_pk PRIMARY KEY (store_id, order_id);


--
-- Name: review_requests review_requests_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_requests
    ADD CONSTRAINT review_requests_token_key UNIQUE (token_hash);


--
-- Name: review_settings review_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_settings
    ADD CONSTRAINT review_settings_pkey PRIMARY KEY (store_id);


--
-- Name: sandboxes sandboxes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sandboxes
    ADD CONSTRAINT sandboxes_pkey PRIMARY KEY (id);


--
-- Name: sandboxes sandboxes_store_id_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sandboxes
    ADD CONSTRAINT sandboxes_store_id_unique UNIQUE (store_id);


--
-- Name: saved_parts saved_parts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_parts
    ADD CONSTRAINT saved_parts_pkey PRIMARY KEY (id);


--
-- Name: saved_reports saved_reports_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_reports
    ADD CONSTRAINT saved_reports_pkey PRIMARY KEY (id);


--
-- Name: search_cache search_cache_store_id_kind_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_cache
    ADD CONSTRAINT search_cache_store_id_kind_key_pk PRIMARY KEY (store_id, kind, key);


--
-- Name: search_clicks search_clicks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_clicks
    ADD CONSTRAINT search_clicks_pkey PRIMARY KEY (id);


--
-- Name: search_experiments search_experiments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_experiments
    ADD CONSTRAINT search_experiments_pkey PRIMARY KEY (id);


--
-- Name: search_queries search_queries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_queries
    ADD CONSTRAINT search_queries_pkey PRIMARY KEY (id);


--
-- Name: search_rules search_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_rules
    ADD CONSTRAINT search_rules_pkey PRIMARY KEY (id);


--
-- Name: search_settings search_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_settings
    ADD CONSTRAINT search_settings_pkey PRIMARY KEY (id);


--
-- Name: search_settings search_settings_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_settings
    ADD CONSTRAINT search_settings_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: search_synonyms search_synonyms_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_synonyms
    ADD CONSTRAINT search_synonyms_pkey PRIMARY KEY (id);


--
-- Name: segments segments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.segments
    ADD CONSTRAINT segments_pkey PRIMARY KEY (id);


--
-- Name: segments segments_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.segments
    ADD CONSTRAINT segments_store_id_key UNIQUE (store_id, id);


--
-- Name: selling_plans selling_plans_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.selling_plans
    ADD CONSTRAINT selling_plans_pkey PRIMARY KEY (id);


--
-- Name: selling_plans selling_plans_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.selling_plans
    ADD CONSTRAINT selling_plans_store_id_key UNIQUE (store_id, id);


--
-- Name: shipment_lines shipment_lines_shipment_id_order_line_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipment_lines
    ADD CONSTRAINT shipment_lines_shipment_id_order_line_id_pk PRIMARY KEY (shipment_id, order_line_id);


--
-- Name: shipment_tracking shipment_tracking_store_id_shipment_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipment_tracking
    ADD CONSTRAINT shipment_tracking_store_id_shipment_id_pk PRIMARY KEY (store_id, shipment_id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipments
    ADD CONSTRAINT shipments_store_id_key UNIQUE (store_id, id);


--
-- Name: shipping_carriers shipping_carriers_store_id_carrier_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_carriers
    ADD CONSTRAINT shipping_carriers_store_id_carrier_pk PRIMARY KEY (store_id, carrier);


--
-- Name: shipping_method_rates shipping_method_rates_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_method_rates
    ADD CONSTRAINT shipping_method_rates_pkey PRIMARY KEY (id);


--
-- Name: shipping_method_rates shipping_method_rates_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_method_rates
    ADD CONSTRAINT shipping_method_rates_store_id_key UNIQUE (store_id, id);


--
-- Name: shipping_methods shipping_methods_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_methods
    ADD CONSTRAINT shipping_methods_pkey PRIMARY KEY (id);


--
-- Name: shipping_methods shipping_methods_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_methods
    ADD CONSTRAINT shipping_methods_store_id_key UNIQUE (store_id, id);


--
-- Name: shipping_profiles shipping_profiles_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_profiles
    ADD CONSTRAINT shipping_profiles_pkey PRIMARY KEY (id);


--
-- Name: shipping_profiles shipping_profiles_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_profiles
    ADD CONSTRAINT shipping_profiles_store_id_key UNIQUE (store_id, id);


--
-- Name: shipping_rates shipping_rates_store_id_market_code_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_rates
    ADD CONSTRAINT shipping_rates_store_id_market_code_pk PRIMARY KEY (store_id, market_code);


--
-- Name: shipping_settings shipping_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_settings
    ADD CONSTRAINT shipping_settings_pkey PRIMARY KEY (store_id);


--
-- Name: shipping_vat_rules shipping_vat_rules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_vat_rules
    ADD CONSTRAINT shipping_vat_rules_pkey PRIMARY KEY (country_code);


--
-- Name: shipping_zones shipping_zones_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_zones
    ADD CONSTRAINT shipping_zones_pkey PRIMARY KEY (id);


--
-- Name: shipping_zones shipping_zones_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_zones
    ADD CONSTRAINT shipping_zones_store_id_key UNIQUE (store_id, id);


--
-- Name: shop_move_items shop_move_items_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shop_move_items
    ADD CONSTRAINT shop_move_items_pkey PRIMARY KEY (store_id, kind, ref);


--
-- Name: shop_moves shop_moves_store_id_source_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shop_moves
    ADD CONSTRAINT shop_moves_store_id_source_pk PRIMARY KEY (store_id, source);


--
-- Name: signup_incentives signup_incentives_once; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.signup_incentives
    ADD CONSTRAINT signup_incentives_once UNIQUE (store_id, discount_id, email);


--
-- Name: signup_incentives signup_incentives_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.signup_incentives
    ADD CONSTRAINT signup_incentives_pkey PRIMARY KEY (id);


--
-- Name: site_staging_pages site_staging_pages_staging_id_page_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_staging_pages
    ADD CONSTRAINT site_staging_pages_staging_id_page_id_pk PRIMARY KEY (staging_id, page_id);


--
-- Name: site_stagings site_stagings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_stagings
    ADD CONSTRAINT site_stagings_pkey PRIMARY KEY (id);


--
-- Name: site_stagings site_stagings_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_stagings
    ADD CONSTRAINT site_stagings_store_id_key UNIQUE (store_id, id);


--
-- Name: sms_campaigns sms_campaigns_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_campaigns
    ADD CONSTRAINT sms_campaigns_pkey PRIMARY KEY (id);


--
-- Name: sms_campaigns sms_campaigns_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_campaigns
    ADD CONSTRAINT sms_campaigns_store_id_key UNIQUE (store_id, id);


--
-- Name: sms_consent_events sms_consent_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_consent_events
    ADD CONSTRAINT sms_consent_events_pkey PRIMARY KEY (id);


--
-- Name: sms_messages sms_messages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_messages
    ADD CONSTRAINT sms_messages_pkey PRIMARY KEY (id);


--
-- Name: sms_settings sms_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_settings
    ADD CONSTRAINT sms_settings_pkey PRIMARY KEY (store_id);


--
-- Name: sms_subscribers sms_subscribers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_subscribers
    ADD CONSTRAINT sms_subscribers_pkey PRIMARY KEY (id);


--
-- Name: sms_subscribers sms_subscribers_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_subscribers
    ADD CONSTRAINT sms_subscribers_store_id_key UNIQUE (store_id, id);


--
-- Name: speed_samples speed_samples_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.speed_samples
    ADD CONSTRAINT speed_samples_pkey PRIMARY KEY (id);


--
-- Name: staff_alert_recipients staff_alert_recipients_store_id_account_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.staff_alert_recipients
    ADD CONSTRAINT staff_alert_recipients_store_id_account_id_pk PRIMARY KEY (store_id, account_id);


--
-- Name: staff_alert_settings staff_alert_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.staff_alert_settings
    ADD CONSTRAINT staff_alert_settings_pkey PRIMARY KEY (store_id);


--
-- Name: standing_deliveries standing_deliveries_list_day_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_deliveries
    ADD CONSTRAINT standing_deliveries_list_day_key UNIQUE (standing_order_id, delivery_date);


--
-- Name: standing_deliveries standing_deliveries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_deliveries
    ADD CONSTRAINT standing_deliveries_pkey PRIMARY KEY (id);


--
-- Name: standing_order_lines standing_order_lines_standing_order_id_variant_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_order_lines
    ADD CONSTRAINT standing_order_lines_standing_order_id_variant_id_pk PRIMARY KEY (standing_order_id, variant_id);


--
-- Name: standing_orders standing_orders_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_orders
    ADD CONSTRAINT standing_orders_pkey PRIMARY KEY (id);


--
-- Name: standing_orders standing_orders_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_orders
    ADD CONSTRAINT standing_orders_store_id_key UNIQUE (store_id, id);


--
-- Name: status_checks status_checks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.status_checks
    ADD CONSTRAINT status_checks_pkey PRIMARY KEY (id);


--
-- Name: status_incident_updates status_incident_updates_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.status_incident_updates
    ADD CONSTRAINT status_incident_updates_pkey PRIMARY KEY (id);


--
-- Name: status_incidents status_incidents_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.status_incidents
    ADD CONSTRAINT status_incidents_pkey PRIMARY KEY (id);


--
-- Name: status_subscribers status_subscribers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.status_subscribers
    ADD CONSTRAINT status_subscribers_pkey PRIMARY KEY (id);


--
-- Name: stock_alerts stock_alerts_store_id_variant_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_alerts
    ADD CONSTRAINT stock_alerts_store_id_variant_id_pk PRIMARY KEY (store_id, variant_id);


--
-- Name: stock_requests stock_requests_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_requests
    ADD CONSTRAINT stock_requests_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer_lines stock_transfer_lines_transfer_id_variant_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfer_lines
    ADD CONSTRAINT stock_transfer_lines_transfer_id_variant_id_pk PRIMARY KEY (transfer_id, variant_id);


--
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);


--
-- Name: stock_transfers stock_transfers_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfers
    ADD CONSTRAINT stock_transfers_store_id_key UNIQUE (store_id, id);


--
-- Name: store_billing store_billing_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_pkey PRIMARY KEY (store_id);


--
-- Name: store_billing store_billing_subscription_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_subscription_key UNIQUE (mode, subscription_id);


--
-- Name: store_business_changes store_business_changes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_business_changes
    ADD CONSTRAINT store_business_changes_pkey PRIMARY KEY (id);


--
-- Name: store_copies store_copies_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_copies
    ADD CONSTRAINT store_copies_pkey PRIMARY KEY (id);


--
-- Name: store_copy_files store_copy_files_copy_id_source_url_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_copy_files
    ADD CONSTRAINT store_copy_files_copy_id_source_url_pk PRIMARY KEY (copy_id, source_url);


--
-- Name: store_currencies store_currencies_store_id_currency_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_currencies
    ADD CONSTRAINT store_currencies_store_id_currency_pk PRIMARY KEY (store_id, currency);


--
-- Name: store_demo_items store_demo_items_store_id_kind_ref_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_demo_items
    ADD CONSTRAINT store_demo_items_store_id_kind_ref_id_pk PRIMARY KEY (store_id, kind, ref_id);


--
-- Name: store_domains store_domains_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_domains
    ADD CONSTRAINT store_domains_pkey PRIMARY KEY (id);


--
-- Name: store_drafts store_drafts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_drafts
    ADD CONSTRAINT store_drafts_pkey PRIMARY KEY (id);


--
-- Name: store_events store_events_once_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_events
    ADD CONSTRAINT store_events_once_key UNIQUE (store_id, event, subject_id);


--
-- Name: store_events store_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_events
    ADD CONSTRAINT store_events_pkey PRIMARY KEY (id);


--
-- Name: store_home_takes store_home_takes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_home_takes
    ADD CONSTRAINT store_home_takes_pkey PRIMARY KEY (id);


--
-- Name: store_integrations store_integrations_store_id_provider_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_integrations
    ADD CONSTRAINT store_integrations_store_id_provider_pk PRIMARY KEY (store_id, provider);


--
-- Name: store_locations store_locations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_locations
    ADD CONSTRAINT store_locations_pkey PRIMARY KEY (id);


--
-- Name: store_locations store_locations_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_locations
    ADD CONSTRAINT store_locations_store_id_key UNIQUE (store_id, id);


--
-- Name: store_members store_members_store_id_account_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_members
    ADD CONSTRAINT store_members_store_id_account_id_pk PRIMARY KEY (store_id, account_id);


--
-- Name: store_roles store_roles_store_id_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_roles
    ADD CONSTRAINT store_roles_store_id_id_pk PRIMARY KEY (store_id, id);


--
-- Name: store_starters store_starters_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_pkey PRIMARY KEY (id);


--
-- Name: store_tax_profile store_tax_profile_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_tax_profile
    ADD CONSTRAINT store_tax_profile_pkey PRIMARY KEY (store_id);


--
-- Name: store_theme_installs store_theme_installs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_theme_installs
    ADD CONSTRAINT store_theme_installs_pkey PRIMARY KEY (id);


--
-- Name: store_themes store_themes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_themes
    ADD CONSTRAINT store_themes_pkey PRIMARY KEY (id);


--
-- Name: store_usage_daily store_usage_daily_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_usage_daily
    ADD CONSTRAINT store_usage_daily_key UNIQUE NULLS NOT DISTINCT (store_id, day, metric);


--
-- Name: store_usage_daily store_usage_daily_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_usage_daily
    ADD CONSTRAINT store_usage_daily_pkey PRIMARY KEY (id);


--
-- Name: storefront_tokens storefront_tokens_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.storefront_tokens
    ADD CONSTRAINT storefront_tokens_pkey PRIMARY KEY (id);


--
-- Name: storefront_tokens storefront_tokens_token_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.storefront_tokens
    ADD CONSTRAINT storefront_tokens_token_unique UNIQUE (token);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: stores stores_slug_not_reserved; Type: CHECK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stores
    ADD CONSTRAINT stores_slug_not_reserved CHECK ((slug <> ALL (ARRAY['account'::text, 'admin'::text, 'api'::text, 'app'::text, 'auth'::text, 'forgot-password'::text, 'help'::text, 'hosting'::text, 'mail'::text, 'platform'::text, 'setup'::text, 'sign-in'::text, 'sign-up'::text, 'status'::text, 'stores'::text, 'support'::text, 'themes'::text, 'try'::text, 'www'::text]))) NOT VALID;


--
-- Name: stores stores_slug_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_slug_unique UNIQUE (slug);


--
-- Name: stripe_accounts stripe_accounts_account_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stripe_accounts
    ADD CONSTRAINT stripe_accounts_account_key UNIQUE (mode, account_id);


--
-- Name: stripe_accounts stripe_accounts_store_id_mode_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stripe_accounts
    ADD CONSTRAINT stripe_accounts_store_id_mode_pk PRIMARY KEY (store_id, mode);


--
-- Name: stripe_sync stripe_sync_mode_kind_local_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stripe_sync
    ADD CONSTRAINT stripe_sync_mode_kind_local_id_pk PRIMARY KEY (mode, kind, local_id);


--
-- Name: subscription_lines subscription_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscription_lines
    ADD CONSTRAINT subscription_lines_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_manage_token_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscriptions
    ADD CONSTRAINT subscriptions_manage_token_unique UNIQUE (manage_token);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscriptions
    ADD CONSTRAINT subscriptions_store_id_key UNIQUE (store_id, id);


--
-- Name: subscriptions subscriptions_store_reference_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscriptions
    ADD CONSTRAINT subscriptions_store_reference_key UNIQUE (store_id, provider, provider_reference);


--
-- Name: supplier_invoices supplier_invoices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_pkey PRIMARY KEY (id);


--
-- Name: supplier_invoices supplier_invoices_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_store_id_key UNIQUE (store_id, id);


--
-- Name: supplier_order_lines supplier_order_lines_supplier_order_id_order_line_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_order_lines
    ADD CONSTRAINT supplier_order_lines_supplier_order_id_order_line_id_pk PRIMARY KEY (supplier_order_id, order_line_id);


--
-- Name: supplier_orders supplier_orders_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_orders
    ADD CONSTRAINT supplier_orders_pkey PRIMARY KEY (id);


--
-- Name: supplier_orders supplier_orders_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_orders
    ADD CONSTRAINT supplier_orders_store_id_key UNIQUE (store_id, id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.suppliers
    ADD CONSTRAINT suppliers_store_id_key UNIQUE (store_id, id);


--
-- Name: support_actions support_actions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_actions
    ADD CONSTRAINT support_actions_pkey PRIMARY KEY (id);


--
-- Name: support_agents support_agents_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_agents
    ADD CONSTRAINT support_agents_key UNIQUE NULLS NOT DISTINCT (store_id, account_id);


--
-- Name: support_agents support_agents_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_agents
    ADD CONSTRAINT support_agents_pkey PRIMARY KEY (id);


--
-- Name: support_conversations support_conversations_email_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_email_token_key UNIQUE (email_token_hash);


--
-- Name: support_conversations support_conversations_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_pkey PRIMARY KEY (id);


--
-- Name: support_conversations support_conversations_reply_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_reply_key UNIQUE (reply_key);


--
-- Name: support_conversations support_conversations_token_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_token_key UNIQUE (token_hash);


--
-- Name: support_inbound_emails support_inbound_emails_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_inbound_emails
    ADD CONSTRAINT support_inbound_emails_pkey PRIMARY KEY (id);


--
-- Name: support_inbound_emails support_inbound_emails_provider_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_inbound_emails
    ADD CONSTRAINT support_inbound_emails_provider_key UNIQUE (provider_id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_seq_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_messages
    ADD CONSTRAINT support_messages_seq_key UNIQUE (conversation_id, seq);


--
-- Name: support_reads support_reads_conversation_id_account_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_reads
    ADD CONSTRAINT support_reads_conversation_id_account_id_pk PRIMARY KEY (conversation_id, account_id);


--
-- Name: support_replies support_replies_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_replies
    ADD CONSTRAINT support_replies_pkey PRIMARY KEY (id);


--
-- Name: support_replies support_replies_shortcut_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_replies
    ADD CONSTRAINT support_replies_shortcut_key UNIQUE NULLS NOT DISTINCT (store_id, shortcut);


--
-- Name: support_settings support_settings_email_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_settings
    ADD CONSTRAINT support_settings_email_key UNIQUE (email_key);


--
-- Name: support_settings support_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_settings
    ADD CONSTRAINT support_settings_pkey PRIMARY KEY (id);


--
-- Name: support_settings support_settings_store_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_settings
    ADD CONSTRAINT support_settings_store_key UNIQUE NULLS NOT DISTINCT (store_id);


--
-- Name: tax_rate_overrides tax_rate_overrides_store_id_currency_rate_date_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tax_rate_overrides
    ADD CONSTRAINT tax_rate_overrides_store_id_currency_rate_date_pk PRIMARY KEY (store_id, currency, rate_date);


--
-- Name: tax_report_exports tax_report_exports_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tax_report_exports
    ADD CONSTRAINT tax_report_exports_pkey PRIMARY KEY (id);


--
-- Name: template_activations template_activations_store_id_part_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.template_activations
    ADD CONSTRAINT template_activations_store_id_part_id_pk PRIMARY KEY (store_id, part_id);


--
-- Name: terms terms_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.terms
    ADD CONSTRAINT terms_pkey PRIMARY KEY (id);


--
-- Name: terms terms_scope_slug_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.terms
    ADD CONSTRAINT terms_scope_slug_key UNIQUE NULLS NOT DISTINCT (store_id, content_type, kind, slug);


--
-- Name: terms terms_store_content_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.terms
    ADD CONSTRAINT terms_store_content_id_key UNIQUE (store_id, content_type, id);


--
-- Name: text_styles text_styles_owner_slug; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.text_styles
    ADD CONSTRAINT text_styles_owner_slug UNIQUE NULLS NOT DISTINCT (store_id, slug);


--
-- Name: text_styles text_styles_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.text_styles
    ADD CONSTRAINT text_styles_pkey PRIMARY KEY (id);


--
-- Name: theme_install_updates theme_install_updates_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_install_updates
    ADD CONSTRAINT theme_install_updates_pkey PRIMARY KEY (id);


--
-- Name: theme_prices theme_prices_preset_id_currency_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_prices
    ADD CONSTRAINT theme_prices_preset_id_currency_pk PRIMARY KEY (preset_id, currency);


--
-- Name: theme_purchases theme_purchases_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_purchases
    ADD CONSTRAINT theme_purchases_pkey PRIMARY KEY (id);


--
-- Name: theme_purchases theme_purchases_stripe_invoice_id_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_purchases
    ADD CONSTRAINT theme_purchases_stripe_invoice_id_unique UNIQUE (stripe_invoice_id);


--
-- Name: theme_schedules theme_schedules_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_schedules
    ADD CONSTRAINT theme_schedules_pkey PRIMARY KEY (id);


--
-- Name: theme_shots theme_shots_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_shots
    ADD CONSTRAINT theme_shots_pkey PRIMARY KEY (id);


--
-- Name: theme_shots theme_shots_unit; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_shots
    ADD CONSTRAINT theme_shots_unit UNIQUE NULLS NOT DISTINCT (preset_id, version, variation, showcase_store_id, kind);


--
-- Name: theme_submissions theme_submissions_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_submissions
    ADD CONSTRAINT theme_submissions_pkey PRIMARY KEY (id);


--
-- Name: tripletex_connections tripletex_connections_company_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tripletex_connections
    ADD CONSTRAINT tripletex_connections_company_key UNIQUE (mode, company_id);


--
-- Name: tripletex_connections tripletex_connections_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tripletex_connections
    ADD CONSTRAINT tripletex_connections_pkey PRIMARY KEY (store_id);


--
-- Name: tripletex_sync tripletex_sync_store_id_mode_company_id_kind_local_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tripletex_sync
    ADD CONSTRAINT tripletex_sync_store_id_mode_company_id_kind_local_id_pk PRIMARY KEY (store_id, mode, company_id, kind, local_id);


--
-- Name: turnover_thresholds turnover_thresholds_store_id_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.turnover_thresholds
    ADD CONSTRAINT turnover_thresholds_store_id_id_pk PRIMARY KEY (store_id, id);


--
-- Name: ui_translations ui_translations_lang_key_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ui_translations
    ADD CONSTRAINT ui_translations_lang_key_pk PRIMARY KEY (lang, key);


--
-- Name: unsent_closures unsent_closures_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.unsent_closures
    ADD CONSTRAINT unsent_closures_pkey PRIMARY KEY (id);


--
-- Name: variant_cost_history variant_cost_history_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.variant_cost_history
    ADD CONSTRAINT variant_cost_history_pkey PRIMARY KEY (id);


--
-- Name: vat_categories vat_categories_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_categories
    ADD CONSTRAINT vat_categories_pkey PRIMARY KEY (code);


--
-- Name: vat_checks vat_checks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_checks
    ADD CONSTRAINT vat_checks_pkey PRIMARY KEY (id);


--
-- Name: vat_checks vat_checks_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_checks
    ADD CONSTRAINT vat_checks_store_id_key UNIQUE (store_id, id);


--
-- Name: vat_rates vat_rates_country_code_category_valid_from_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_rates
    ADD CONSTRAINT vat_rates_country_code_category_valid_from_pk PRIMARY KEY (country_code, category, valid_from);


--
-- Name: visits visits_day_visitor_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.visits
    ADD CONSTRAINT visits_day_visitor_key UNIQUE (store_id, day, visitor);


--
-- Name: visits visits_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);


--
-- Name: webhook_endpoints webhook_endpoints_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_pkey PRIMARY KEY (id);


--
-- Name: webhook_endpoints webhook_endpoints_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_store_id_key UNIQUE (store_id, id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_provider_event_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_events
    ADD CONSTRAINT webhook_events_provider_event_key UNIQUE (store_id, provider, event_id);


--
-- Name: wishlist_cart_adds wishlist_cart_adds_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_cart_adds
    ADD CONSTRAINT wishlist_cart_adds_pkey PRIMARY KEY (id);


--
-- Name: wishlist_items wishlist_items_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_items
    ADD CONSTRAINT wishlist_items_pkey PRIMARY KEY (id);


--
-- Name: wishlist_items wishlist_items_product_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_items
    ADD CONSTRAINT wishlist_items_product_key UNIQUE (wishlist_id, product_id);


--
-- Name: wishlists wishlists_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlists
    ADD CONSTRAINT wishlists_pkey PRIMARY KEY (id);


--
-- Name: wishlists wishlists_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlists
    ADD CONSTRAINT wishlists_store_id_key UNIQUE (store_id, id);


--
-- Name: withdrawal_attempts withdrawal_attempts_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_attempts
    ADD CONSTRAINT withdrawal_attempts_pkey PRIMARY KEY (id);


--
-- Name: withdrawal_request_lines withdrawal_request_lines_withdrawal_request_id_order_line_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_request_lines
    ADD CONSTRAINT withdrawal_request_lines_withdrawal_request_id_order_line_id_pk PRIMARY KEY (withdrawal_request_id, order_line_id);


--
-- Name: withdrawal_requests withdrawal_requests_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_pkey PRIMARY KEY (id);


--
-- Name: withdrawal_requests withdrawal_requests_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_store_id_key UNIQUE (store_id, id);


--
-- Name: wordpress_connections wordpress_connections_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wordpress_connections
    ADD CONSTRAINT wordpress_connections_pkey PRIMARY KEY (id);


--
-- Name: work_assignments work_assignments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_assignments
    ADD CONSTRAINT work_assignments_pkey PRIMARY KEY (id);


--
-- Name: work_assignments work_assignments_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_assignments
    ADD CONSTRAINT work_assignments_store_id_key UNIQUE (store_id, id);


--
-- Name: work_clients work_clients_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_clients
    ADD CONSTRAINT work_clients_pkey PRIMARY KEY (id);


--
-- Name: work_clients work_clients_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_clients
    ADD CONSTRAINT work_clients_store_id_key UNIQUE (store_id, id);


--
-- Name: work_credit_notes work_credit_notes_document_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_document_number_key UNIQUE (store_id, document_number);


--
-- Name: work_credit_notes work_credit_notes_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_pkey PRIMARY KEY (id);


--
-- Name: work_credit_notes work_credit_notes_series_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_series_number_key UNIQUE (store_id, series, number);


--
-- Name: work_credit_notes work_credit_notes_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_store_id_key UNIQUE (store_id, id);


--
-- Name: work_events work_events_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_events
    ADD CONSTRAINT work_events_pkey PRIMARY KEY (id);


--
-- Name: work_invoice_lines work_invoice_lines_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_lines
    ADD CONSTRAINT work_invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: work_invoice_lines work_invoice_lines_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_lines
    ADD CONSTRAINT work_invoice_lines_store_id_key UNIQUE (store_id, id);


--
-- Name: work_invoice_losses work_invoice_losses_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_losses
    ADD CONSTRAINT work_invoice_losses_pkey PRIMARY KEY (id);


--
-- Name: work_invoice_losses work_invoice_losses_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_losses
    ADD CONSTRAINT work_invoice_losses_store_id_key UNIQUE (store_id, id);


--
-- Name: work_invoice_payments work_invoice_payments_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_payments
    ADD CONSTRAINT work_invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: work_invoice_payments work_invoice_payments_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_payments
    ADD CONSTRAINT work_invoice_payments_store_id_key UNIQUE (store_id, id);


--
-- Name: work_invoices work_invoices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_pkey PRIMARY KEY (id);


--
-- Name: work_invoices work_invoices_public_token_unique; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_public_token_unique UNIQUE (public_token);


--
-- Name: work_invoices work_invoices_recurring_period_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_recurring_period_key UNIQUE (store_id, recurring_invoice_id, recurring_period);


--
-- Name: work_invoices work_invoices_series_number_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_series_number_key UNIQUE (store_id, series, number);


--
-- Name: work_invoices work_invoices_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_store_id_key UNIQUE (store_id, id);


--
-- Name: work_recurring_invoices work_recurring_invoices_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_recurring_invoices
    ADD CONSTRAINT work_recurring_invoices_pkey PRIMARY KEY (id);


--
-- Name: work_recurring_invoices work_recurring_invoices_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_recurring_invoices
    ADD CONSTRAINT work_recurring_invoices_store_id_key UNIQUE (store_id, id);


--
-- Name: work_settings work_settings_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_settings
    ADD CONSTRAINT work_settings_pkey PRIMARY KEY (store_id);


--
-- Name: work_tasks work_tasks_assignment_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_tasks
    ADD CONSTRAINT work_tasks_assignment_key UNIQUE (store_id, assignment_id, id);


--
-- Name: work_tasks work_tasks_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_tasks
    ADD CONSTRAINT work_tasks_pkey PRIMARY KEY (id);


--
-- Name: work_tasks work_tasks_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_tasks
    ADD CONSTRAINT work_tasks_store_id_key UNIQUE (store_id, id);


--
-- Name: work_time_entries work_time_entries_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_time_entries
    ADD CONSTRAINT work_time_entries_pkey PRIMARY KEY (id);


--
-- Name: work_time_entries work_time_entries_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_time_entries
    ADD CONSTRAINT work_time_entries_store_id_key UNIQUE (store_id, id);


--
-- Name: work_timers work_timers_store_id_account_id_pk; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_timers
    ADD CONSTRAINT work_timers_store_id_account_id_pk PRIMARY KEY (store_id, account_id);


--
-- Name: workflow_runs workflow_runs_once_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflow_runs
    ADD CONSTRAINT workflow_runs_once_key UNIQUE (workflow_id, event_key);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_store_id_key; Type: CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflows
    ADD CONSTRAINT workflows_store_id_key UNIQUE (store_id, id);


--
-- Name: abandoned_checkouts_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX abandoned_checkouts_due_idx ON commerce.abandoned_checkouts USING btree (captured_at) WHERE ((recovered_at IS NULL) AND (opted_out_at IS NULL) AND (email IS NOT NULL));


--
-- Name: abandoned_checkouts_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX abandoned_checkouts_email_idx ON commerce.abandoned_checkouts USING btree (store_id, lower(email));


--
-- Name: abandoned_checkouts_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX abandoned_checkouts_store_idx ON commerce.abandoned_checkouts USING btree (store_id, created_at);


--
-- Name: abandoned_plan_checkouts_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX abandoned_plan_checkouts_account_idx ON commerce.abandoned_plan_checkouts USING btree (account_id);


--
-- Name: abandoned_plan_checkouts_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX abandoned_plan_checkouts_due_idx ON commerce.abandoned_plan_checkouts USING btree (captured_at) WHERE ((recovered_at IS NULL) AND (opted_out_at IS NULL) AND (email IS NOT NULL));


--
-- Name: abandoned_plan_checkouts_price_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX abandoned_plan_checkouts_price_idx ON commerce.abandoned_plan_checkouts USING btree (price_id);


--
-- Name: access_requests_confirm_hash_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX access_requests_confirm_hash_idx ON commerce.access_requests USING btree (confirm_hash);


--
-- Name: access_requests_decided_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX access_requests_decided_by_idx ON commerce.access_requests USING btree (decided_by);


--
-- Name: access_requests_design_preset_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX access_requests_design_preset_idx ON commerce.access_requests USING btree (design_preset_id);


--
-- Name: access_requests_pending_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX access_requests_pending_email_idx ON commerce.access_requests USING btree (lower(email)) WHERE (status = 'pending'::commerce.access_request_status);


--
-- Name: access_requests_sandbox_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX access_requests_sandbox_idx ON commerce.access_requests USING btree (sandbox_id);


--
-- Name: access_requests_starter_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX access_requests_starter_idx ON commerce.access_requests USING btree (starter_id);


--
-- Name: access_requests_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX access_requests_status_idx ON commerce.access_requests USING btree (status, created_at);


--
-- Name: access_requests_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX access_requests_store_idx ON commerce.access_requests USING btree (store_id);


--
-- Name: accessibility_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX accessibility_settings_updated_by_idx ON commerce.accessibility_settings USING btree (updated_by);


--
-- Name: account_recovery_codes_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX account_recovery_codes_account_idx ON commerce.account_recovery_codes USING btree (account_id);


--
-- Name: accounts_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX accounts_email_idx ON commerce.accounts USING btree (lower(email));


--
-- Name: activities_assignee_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_assignee_idx ON commerce.activities USING btree (assignee_id);


--
-- Name: activities_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_company_idx ON commerce.activities USING btree (store_id, company_id) WHERE (company_id IS NOT NULL);


--
-- Name: activities_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_created_by_idx ON commerce.activities USING btree (created_by);


--
-- Name: activities_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_customer_idx ON commerce.activities USING btree (store_id, customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: activities_deal_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_deal_idx ON commerce.activities USING btree (store_id, deal_id) WHERE (deal_id IS NOT NULL);


--
-- Name: activities_done_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_done_by_idx ON commerce.activities USING btree (done_by);


--
-- Name: activities_due_push_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_due_push_idx ON commerce.activities USING btree (due_at) WHERE (timed AND (done_at IS NULL) AND (notified_at IS NULL));


--
-- Name: activities_store_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_store_due_idx ON commerce.activities USING btree (store_id, due_at) WHERE (done_at IS NULL);


--
-- Name: activities_today_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX activities_today_idx ON commerce.activities USING btree (store_id, assignee_id, due_at) WHERE (done_at IS NULL);


--
-- Name: ad_conversions_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ad_conversions_due_idx ON commerce.ad_conversions USING btree (status, next_at);


--
-- Name: ad_conversions_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ad_conversions_store_idx ON commerce.ad_conversions USING btree (store_id, created_at);


--
-- Name: affiliate_attributions_affiliate_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX affiliate_attributions_affiliate_idx ON commerce.affiliate_attributions USING btree (store_id, affiliate_customer_id, created_at);


--
-- Name: affiliate_attributions_friend_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX affiliate_attributions_friend_idx ON commerce.affiliate_attributions USING btree (store_id, friend_customer_id);


--
-- Name: affiliate_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX affiliate_settings_updated_by_idx ON commerce.affiliate_settings USING btree (updated_by);


--
-- Name: ai_eval_runs_ran_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_eval_runs_ran_idx ON commerce.ai_eval_runs USING btree (suite, ran_at);


--
-- Name: ai_model_prices_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_model_prices_created_by_idx ON commerce.ai_model_prices USING btree (created_by);


--
-- Name: ai_providers_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_providers_updated_by_idx ON commerce.ai_providers USING btree (updated_by);


--
-- Name: ai_usage_actor_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_usage_actor_idx ON commerce.ai_usage USING btree (actor_account_id);


--
-- Name: ai_usage_autopilot_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_usage_autopilot_idx ON commerce.ai_usage USING btree (store_id, created_at) WHERE (acted_by = 'autopilot'::text);


--
-- Name: ai_usage_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_usage_created_idx ON commerce.ai_usage USING btree (created_at);


--
-- Name: ai_usage_owner_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_usage_owner_idx ON commerce.ai_usage USING btree (owner_account_id, created_at);


--
-- Name: ai_usage_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ai_usage_store_idx ON commerce.ai_usage USING btree (store_id, created_at);


--
-- Name: analytics_targets_period_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX analytics_targets_period_key ON commerce.analytics_targets USING btree (store_id, metric, period, starts_on);


--
-- Name: api_app_idempotency_keys_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_app_idempotency_keys_created_idx ON commerce.api_app_idempotency_keys USING btree (created_at);


--
-- Name: api_idempotency_keys_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_idempotency_keys_created_idx ON commerce.api_idempotency_keys USING btree (created_at);


--
-- Name: api_tokens_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_tokens_created_by_idx ON commerce.api_tokens USING btree (created_by);


--
-- Name: api_tokens_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_tokens_store_idx ON commerce.api_tokens USING btree (store_id);


--
-- Name: api_uploads_expires_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_uploads_expires_idx ON commerce.api_uploads USING btree (expires_at);


--
-- Name: api_uploads_media_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_uploads_media_idx ON commerce.api_uploads USING btree (media_id);


--
-- Name: api_uploads_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_uploads_store_idx ON commerce.api_uploads USING btree (store_id);


--
-- Name: api_uploads_token_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX api_uploads_token_idx ON commerce.api_uploads USING btree (token_id);


--
-- Name: appointment_settings_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX appointment_settings_location_idx ON commerce.appointment_settings USING btree (store_id, location_id);


--
-- Name: appointment_settings_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX appointment_settings_product_idx ON commerce.appointment_settings USING btree (store_id, product_id);


--
-- Name: apps_developer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX apps_developer_idx ON commerce.apps USING btree (developer_id);


--
-- Name: assistant_approvals_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_approvals_account_idx ON commerce.assistant_approvals USING btree (account_id);


--
-- Name: assistant_approvals_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_approvals_conversation_idx ON commerce.assistant_approvals USING btree (conversation_id, created_at);


--
-- Name: assistant_approvals_oauth_grant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_approvals_oauth_grant_idx ON commerce.assistant_approvals USING btree (oauth_grant_id);


--
-- Name: assistant_approvals_pending_expiry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_approvals_pending_expiry_idx ON commerce.assistant_approvals USING btree (expires_at) WHERE (status = 'pending'::text);


--
-- Name: assistant_approvals_plan_step_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_approvals_plan_step_idx ON commerce.assistant_approvals USING btree (plan_step_id);


--
-- Name: assistant_approvals_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_approvals_store_idx ON commerce.assistant_approvals USING btree (store_id, status);


--
-- Name: assistant_conversations_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_conversations_account_idx ON commerce.assistant_conversations USING btree (account_id);


--
-- Name: assistant_conversations_kaizen_life_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX assistant_conversations_kaizen_life_idx ON commerce.assistant_conversations USING btree (store_id, account_id) WHERE (source = 'kaizen-life'::text);


--
-- Name: assistant_conversations_mcp_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX assistant_conversations_mcp_idx ON commerce.assistant_conversations USING btree (store_id, account_id, oauth_client_id) WHERE (source = 'mcp'::text);


--
-- Name: assistant_conversations_oauth_client_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_conversations_oauth_client_idx ON commerce.assistant_conversations USING btree (oauth_client_id);


--
-- Name: assistant_conversations_owner_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_conversations_owner_idx ON commerce.assistant_conversations USING btree (store_id, account_id, updated_at);


--
-- Name: assistant_follow_ups_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_follow_ups_account_idx ON commerce.assistant_follow_ups USING btree (account_id, store_id, status);


--
-- Name: assistant_follow_ups_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_follow_ups_conversation_idx ON commerce.assistant_follow_ups USING btree (conversation_id);


--
-- Name: assistant_follow_ups_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_follow_ups_due_idx ON commerce.assistant_follow_ups USING btree (status, due_at);


--
-- Name: assistant_follow_ups_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_follow_ups_order_idx ON commerce.assistant_follow_ups USING btree (order_id);


--
-- Name: assistant_follow_ups_rule_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_follow_ups_rule_idx ON commerce.assistant_follow_ups USING btree (store_id, created_at) WHERE (origin = 'rule'::text);


--
-- Name: assistant_follow_ups_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_follow_ups_store_idx ON commerce.assistant_follow_ups USING btree (store_id);


--
-- Name: assistant_goals_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_goals_created_by_idx ON commerce.assistant_goals USING btree (created_by);


--
-- Name: assistant_goals_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_goals_store_idx ON commerce.assistant_goals USING btree (store_id, status);


--
-- Name: assistant_memories_owner_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_memories_owner_idx ON commerce.assistant_memories USING btree (account_id, store_id, importance DESC);


--
-- Name: assistant_memories_search_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_memories_search_idx ON commerce.assistant_memories USING gin (search);


--
-- Name: assistant_memories_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_memories_store_idx ON commerce.assistant_memories USING btree (store_id);


--
-- Name: assistant_messages_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_messages_conversation_idx ON commerce.assistant_messages USING btree (conversation_id, created_at);


--
-- Name: assistant_messages_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_messages_store_idx ON commerce.assistant_messages USING btree (store_id, created_at);


--
-- Name: assistant_notices_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_notices_created_idx ON commerce.assistant_notices USING btree (created_at);


--
-- Name: assistant_notices_once; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX assistant_notices_once ON commerce.assistant_notices USING btree (account_id, kind, ref);


--
-- Name: assistant_notices_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_notices_store_idx ON commerce.assistant_notices USING btree (store_id);


--
-- Name: assistant_notices_unread_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_notices_unread_idx ON commerce.assistant_notices USING btree (account_id, store_id, created_at) WHERE (read_at IS NULL);


--
-- Name: assistant_plan_steps_answered_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_plan_steps_answered_by_idx ON commerce.assistant_plan_steps USING btree (answered_by);


--
-- Name: assistant_plan_steps_key_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX assistant_plan_steps_key_idx ON commerce.assistant_plan_steps USING btree (plan_id, key);


--
-- Name: assistant_plan_steps_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_plan_steps_store_idx ON commerce.assistant_plan_steps USING btree (store_id, status);


--
-- Name: assistant_plans_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_plans_account_idx ON commerce.assistant_plans USING btree (account_id);


--
-- Name: assistant_plans_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_plans_conversation_idx ON commerce.assistant_plans USING btree (conversation_id);


--
-- Name: assistant_plans_goal_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_plans_goal_idx ON commerce.assistant_plans USING btree (goal_id);


--
-- Name: assistant_plans_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_plans_store_idx ON commerce.assistant_plans USING btree (store_id, status);


--
-- Name: assistant_skills_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX assistant_skills_store_idx ON commerce.assistant_skills USING btree (store_id, shared);


--
-- Name: audit_log_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX audit_log_account_idx ON commerce.audit_log USING btree (account_id);


--
-- Name: audit_log_autopilot_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX audit_log_autopilot_idx ON commerce.audit_log USING btree (created_at) WHERE (acted_by = 'autopilot'::text);


--
-- Name: audit_log_store_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX audit_log_store_account_idx ON commerce.audit_log USING btree (store_id, account_id, id DESC);


--
-- Name: audit_log_store_area_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX audit_log_store_area_idx ON commerce.audit_log USING btree (store_id, area, id DESC);


--
-- Name: audit_log_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX audit_log_store_idx ON commerce.audit_log USING btree (store_id, created_at);


--
-- Name: automation_sends_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX automation_sends_order_idx ON commerce.automation_sends USING btree (store_id, order_id);


--
-- Name: automation_sends_report_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX automation_sends_report_idx ON commerce.automation_sends USING btree (store_id, kind, created_at);


--
-- Name: automation_sends_subscriber_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX automation_sends_subscriber_idx ON commerce.automation_sends USING btree (store_id, subscriber_id);


--
-- Name: autopilot_effects_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_effects_store_idx ON commerce.autopilot_effects USING btree (store_id, acted_at);


--
-- Name: autopilot_events_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_events_account_idx ON commerce.autopilot_events USING btree (account_id);


--
-- Name: autopilot_events_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_events_conversation_idx ON commerce.autopilot_events USING btree (conversation_id);


--
-- Name: autopilot_events_pending_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_events_pending_idx ON commerce.autopilot_events USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: autopilot_events_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_events_plan_idx ON commerce.autopilot_events USING btree (plan_id);


--
-- Name: autopilot_events_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_events_store_idx ON commerce.autopilot_events USING btree (store_id, created_at);


--
-- Name: autopilot_reports_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_reports_account_idx ON commerce.autopilot_reports USING btree (account_id, created_at);


--
-- Name: autopilot_reviews_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_reviews_account_idx ON commerce.autopilot_reviews USING btree (account_id);


--
-- Name: autopilot_reviews_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_reviews_conversation_idx ON commerce.autopilot_reviews USING btree (conversation_id);


--
-- Name: autopilot_reviews_goal_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_reviews_goal_idx ON commerce.autopilot_reviews USING btree (goal_id, created_at);


--
-- Name: autopilot_reviews_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_reviews_plan_idx ON commerce.autopilot_reviews USING btree (plan_id);


--
-- Name: autopilot_reviews_running_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX autopilot_reviews_running_idx ON commerce.autopilot_reviews USING btree (goal_id) WHERE (status = 'running'::text);


--
-- Name: autopilot_reviews_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_reviews_store_idx ON commerce.autopilot_reviews USING btree (store_id, created_at);


--
-- Name: autopilot_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX autopilot_settings_updated_by_idx ON commerce.autopilot_settings USING btree (updated_by);


--
-- Name: bank_lines_entry_once; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX bank_lines_entry_once ON commerce.bank_lines USING btree (book_id, entry_id) WHERE (entry_id IS NOT NULL);


--
-- Name: bank_lines_statement_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bank_lines_statement_idx ON commerce.bank_lines USING btree (store_id, statement_id);


--
-- Name: bank_lines_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bank_lines_store_book_idx ON commerce.bank_lines USING btree (store_id, book_id);


--
-- Name: bank_lines_store_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bank_lines_store_entry_idx ON commerce.bank_lines USING btree (store_id, entry_id);


--
-- Name: bank_statements_imported_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bank_statements_imported_by_idx ON commerce.bank_statements USING btree (imported_by);


--
-- Name: bank_statements_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bank_statements_store_book_idx ON commerce.bank_statements USING btree (store_id, book_id);


--
-- Name: blog_comments_decided_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX blog_comments_decided_by_idx ON commerce.blog_comments USING btree (decided_by);


--
-- Name: blog_comments_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX blog_comments_email_idx ON commerce.blog_comments USING btree (store_id, lower(email));


--
-- Name: blog_comments_hash_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX blog_comments_hash_idx ON commerce.blog_comments USING btree (store_id, body_hash, created_at);


--
-- Name: blog_comments_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX blog_comments_page_idx ON commerce.blog_comments USING btree (store_id, page_id, status, created_at);


--
-- Name: blog_comments_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX blog_comments_status_idx ON commerce.blog_comments USING btree (store_id, status, created_at);


--
-- Name: blogs_listing_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX blogs_listing_page_idx ON commerce.blogs USING btree (listing_page_id);


--
-- Name: blogs_one_main_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX blogs_one_main_idx ON commerce.blogs USING btree (store_id) WHERE main;


--
-- Name: bonus_allocations_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_allocations_entry_idx ON commerce.bonus_allocations USING btree (store_id, entry_id);


--
-- Name: bonus_entries_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_entries_created_by_idx ON commerce.bonus_entries USING btree (created_by);


--
-- Name: bonus_entries_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_entries_customer_idx ON commerce.bonus_entries USING btree (store_id, customer_id, created_at);


--
-- Name: bonus_entries_expiry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_entries_expiry_idx ON commerce.bonus_entries USING btree (expires_at) WHERE ((amount_minor > 0) AND (expires_at IS NOT NULL));


--
-- Name: bonus_entries_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_entries_order_idx ON commerce.bonus_entries USING btree (store_id, order_id);


--
-- Name: bonus_entries_refund_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_entries_refund_idx ON commerce.bonus_entries USING btree (store_id, refund_id);


--
-- Name: bonus_rewards_discount_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX bonus_rewards_discount_key ON commerce.bonus_rewards USING btree (discount_id);


--
-- Name: bonus_rewards_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_rewards_product_idx ON commerce.bonus_rewards USING btree (store_id, product_id);


--
-- Name: bonus_rewards_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_rewards_updated_by_idx ON commerce.bonus_rewards USING btree (updated_by);


--
-- Name: bonus_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bonus_settings_updated_by_idx ON commerce.bonus_settings USING btree (updated_by);


--
-- Name: booking_resources_host_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX booking_resources_host_idx ON commerce.booking_resources USING btree (store_id, host_id);


--
-- Name: booking_resources_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX booking_resources_store_idx ON commerce.booking_resources USING btree (store_id, "position");


--
-- Name: booking_seasons_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX booking_seasons_product_idx ON commerce.booking_seasons USING btree (store_id, product_id, "position");


--
-- Name: bookings_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bookings_order_idx ON commerce.bookings USING btree (store_id, order_id);


--
-- Name: bookings_order_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bookings_order_line_idx ON commerce.bookings USING btree (store_id, order_line_id);


--
-- Name: bookings_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bookings_product_idx ON commerce.bookings USING btree (store_id, product_id);


--
-- Name: bookings_reminder_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bookings_reminder_due_idx ON commerce.bookings USING btree (starts_at) WHERE ((status = 'confirmed'::text) AND (reminded_at IS NULL));


--
-- Name: bookings_resource_time_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bookings_resource_time_idx ON commerce.bookings USING btree (store_id, resource_id, blocked_from);


--
-- Name: bookings_store_starts_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bookings_store_starts_idx ON commerce.bookings USING btree (store_id, starts_at);


--
-- Name: bookings_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bookings_variant_idx ON commerce.bookings USING btree (store_id, variant_id);


--
-- Name: books_email_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX books_email_key ON commerce.books_email USING btree (key);


--
-- Name: books_inbox_decided_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX books_inbox_decided_by_idx ON commerce.books_inbox USING btree (decided_by);


--
-- Name: books_inbox_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX books_inbox_entry_idx ON commerce.books_inbox USING btree (store_id, entry_id);


--
-- Name: books_inbox_file_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX books_inbox_file_key ON commerce.books_inbox USING btree (store_id, sha256);


--
-- Name: books_inbox_waiting_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX books_inbox_waiting_idx ON commerce.books_inbox USING btree (store_id, received_at) WHERE (status = 'waiting'::text);


--
-- Name: brand_profiles_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX brand_profiles_updated_by_idx ON commerce.brand_profiles USING btree (updated_by);


--
-- Name: broadcast_recipients_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcast_recipients_email_idx ON commerce.broadcast_recipients USING btree (store_id, email);


--
-- Name: broadcast_recipients_message_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcast_recipients_message_idx ON commerce.broadcast_recipients USING btree (email_message_id);


--
-- Name: broadcast_recipients_queue_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcast_recipients_queue_idx ON commerce.broadcast_recipients USING btree (broadcast_id, status);


--
-- Name: broadcast_templates_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcast_templates_created_by_idx ON commerce.broadcast_templates USING btree (created_by);


--
-- Name: broadcast_templates_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcast_templates_list_idx ON commerce.broadcast_templates USING btree (store_id, created_at);


--
-- Name: broadcasts_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcasts_created_by_idx ON commerce.broadcasts USING btree (created_by);


--
-- Name: broadcasts_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcasts_due_idx ON commerce.broadcasts USING btree (scheduled_for) WHERE (status = 'scheduled'::text);


--
-- Name: broadcasts_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcasts_list_idx ON commerce.broadcasts USING btree (store_id, created_at);


--
-- Name: broadcasts_segment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcasts_segment_idx ON commerce.broadcasts USING btree (segment_id);


--
-- Name: broadcasts_sending_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX broadcasts_sending_idx ON commerce.broadcasts USING btree (status) WHERE (status = 'sending'::text);


--
-- Name: bulk_edit_batches_one_undo_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX bulk_edit_batches_one_undo_idx ON commerce.bulk_edit_batches USING btree (store_id, undo_of) WHERE (undo_of IS NOT NULL);


--
-- Name: bulk_edit_batches_requested_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bulk_edit_batches_requested_by_idx ON commerce.bulk_edit_batches USING btree (requested_by);


--
-- Name: bulk_edit_batches_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bulk_edit_batches_store_idx ON commerce.bulk_edit_batches USING btree (store_id, created_at DESC NULLS LAST);


--
-- Name: bulk_edit_items_batch_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bulk_edit_items_batch_idx ON commerce.bulk_edit_items USING btree (store_id, batch_id);


--
-- Name: bulk_edit_items_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bulk_edit_items_product_idx ON commerce.bulk_edit_items USING btree (store_id, product_id);


--
-- Name: bundle_components_bundle_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bundle_components_bundle_idx ON commerce.bundle_components USING btree (store_id, bundle_variant_id);


--
-- Name: bundle_components_component_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX bundle_components_component_idx ON commerce.bundle_components USING btree (store_id, component_variant_id);


--
-- Name: calendar_feeds_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX calendar_feeds_due_idx ON commerce.calendar_feeds USING btree (synced_at);


--
-- Name: calendar_feeds_resource_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX calendar_feeds_resource_idx ON commerce.calendar_feeds USING btree (store_id, resource_id);


--
-- Name: campaigns_gift_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX campaigns_gift_variant_idx ON commerce.campaigns USING btree (store_id, gift_variant_id);


--
-- Name: campaigns_segment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX campaigns_segment_idx ON commerce.campaigns USING btree (store_id, segment_id);


--
-- Name: campaigns_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX campaigns_store_idx ON commerce.campaigns USING btree (store_id, active);


--
-- Name: capacity_events_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX capacity_events_created_by_idx ON commerce.capacity_events USING btree (created_by);


--
-- Name: capacity_events_starts_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX capacity_events_starts_idx ON commerce.capacity_events USING btree (starts_at);


--
-- Name: capacity_events_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX capacity_events_store_idx ON commerce.capacity_events USING btree (store_id, starts_at);


--
-- Name: carrier_labels_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carrier_labels_created_idx ON commerce.carrier_labels USING btree (created_at);


--
-- Name: carrier_labels_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carrier_labels_order_idx ON commerce.carrier_labels USING btree (store_id, order_id);


--
-- Name: carrier_labels_return_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX carrier_labels_return_key ON commerce.carrier_labels USING btree (store_id, return_id) WHERE (return_id IS NOT NULL);


--
-- Name: carrier_labels_shipment_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX carrier_labels_shipment_key ON commerce.carrier_labels USING btree (store_id, shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- Name: cart_gift_cards_card_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cart_gift_cards_card_idx ON commerce.cart_gift_cards USING btree (store_id, card_id);


--
-- Name: cart_lines_selling_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cart_lines_selling_plan_idx ON commerce.cart_lines USING btree (store_id, selling_plan_id);


--
-- Name: cart_lines_store_cart_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cart_lines_store_cart_idx ON commerce.cart_lines USING btree (store_id, cart_id);


--
-- Name: cart_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cart_lines_variant_idx ON commerce.cart_lines USING btree (store_id, variant_id);


--
-- Name: cart_reminder_steps_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cart_reminder_steps_store_idx ON commerce.cart_reminder_steps USING btree (store_id, delay_minutes);


--
-- Name: carts_api_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX carts_api_idx ON commerce.carts USING btree (api_hash);


--
-- Name: carts_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carts_customer_idx ON commerce.carts USING btree (store_id, customer_id);


--
-- Name: carts_handoff_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX carts_handoff_idx ON commerce.carts USING btree (handoff_hash);


--
-- Name: carts_local_area_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carts_local_area_idx ON commerce.carts USING btree (local_area_id);


--
-- Name: carts_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carts_market_idx ON commerce.carts USING btree (store_id, market_code, currency);


--
-- Name: carts_pickup_option_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carts_pickup_option_idx ON commerce.carts USING btree (pickup_option_id);


--
-- Name: carts_shipping_method_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carts_shipping_method_idx ON commerce.carts USING btree (shipping_method_id);


--
-- Name: carts_vat_check_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carts_vat_check_idx ON commerce.carts USING btree (store_id, vat_check_id);


--
-- Name: carts_visit_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX carts_visit_idx ON commerce.carts USING btree (visit_id);


--
-- Name: chat_agents_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX chat_agents_updated_by_idx ON commerce.chat_agents USING btree (updated_by);


--
-- Name: checkout_fields_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX checkout_fields_store_idx ON commerce.checkout_fields USING btree (store_id, "position");


--
-- Name: checkout_providers_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX checkout_providers_updated_by_idx ON commerce.checkout_providers USING btree (updated_by);


--
-- Name: checkout_rule_skips_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX checkout_rule_skips_store_idx ON commerce.checkout_rule_skips USING btree (store_id);


--
-- Name: checkout_rules_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX checkout_rules_created_by_idx ON commerce.checkout_rules USING btree (created_by);


--
-- Name: checkout_rules_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX checkout_rules_store_idx ON commerce.checkout_rules USING btree (store_id, "position") WHERE enabled;


--
-- Name: checkout_rules_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX checkout_rules_updated_by_idx ON commerce.checkout_rules USING btree (updated_by);


--
-- Name: company_invites_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX company_invites_company_idx ON commerce.company_invites USING btree (store_id, company_id, created_at);


--
-- Name: company_invites_one_pending_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX company_invites_one_pending_idx ON commerce.company_invites USING btree (company_id, lower(email)) WHERE (status = 'pending'::text);


--
-- Name: company_location_buyers_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX company_location_buyers_customer_idx ON commerce.company_location_buyers USING btree (store_id, customer_id);


--
-- Name: company_location_buyers_location_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX company_location_buyers_location_fk_idx ON commerce.company_location_buyers USING btree (store_id, location_id);


--
-- Name: company_locations_company_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX company_locations_company_fk_idx ON commerce.company_locations USING btree (store_id, company_id);


--
-- Name: company_locations_name_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX company_locations_name_idx ON commerce.company_locations USING btree (company_id, lower(name));


--
-- Name: consents_store_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX consents_store_created_idx ON commerce.consents USING btree (store_id, created_at);


--
-- Name: consents_visitor_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX consents_visitor_idx ON commerce.consents USING btree (visitor);


--
-- Name: content_entries_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_entries_created_by_idx ON commerce.content_entries USING btree (created_by);


--
-- Name: content_entries_store_type_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_entries_store_type_idx ON commerce.content_entries USING btree (store_id, type_id, "position");


--
-- Name: content_entries_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_entries_updated_by_idx ON commerce.content_entries USING btree (updated_by);


--
-- Name: content_reports_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_reports_product_idx ON commerce.content_reports USING btree (product_id);


--
-- Name: content_reports_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_reports_status_idx ON commerce.content_reports USING btree (status, created_at);


--
-- Name: content_reports_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_reports_store_idx ON commerce.content_reports USING btree (store_id);


--
-- Name: content_screened_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_screened_store_idx ON commerce.content_screened USING btree (store_id);


--
-- Name: content_types_layout_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_types_layout_idx ON commerce.content_types USING btree (layout_id);


--
-- Name: content_types_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX content_types_updated_by_idx ON commerce.content_types USING btree (updated_by);


--
-- Name: cookie_notes_item_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX cookie_notes_item_idx ON commerce.cookie_notes USING btree (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name, domain);


--
-- Name: cookie_notes_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cookie_notes_store_idx ON commerce.cookie_notes USING btree (store_id);


--
-- Name: cookie_notes_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cookie_notes_updated_by_idx ON commerce.cookie_notes USING btree (updated_by);


--
-- Name: cookie_scans_one_active_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX cookie_scans_one_active_idx ON commerce.cookie_scans USING btree (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: cookie_scans_requested_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cookie_scans_requested_by_idx ON commerce.cookie_scans USING btree (requested_by);


--
-- Name: cookie_scans_store_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX cookie_scans_store_created_idx ON commerce.cookie_scans USING btree (store_id, created_at);


--
-- Name: creator_attributions_creator_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX creator_attributions_creator_idx ON commerce.creator_attributions USING btree (store_id, creator_id, created_at);


--
-- Name: creator_commissions_creator_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX creator_commissions_creator_idx ON commerce.creator_commissions USING btree (store_id, creator_id, created_at);


--
-- Name: creator_commissions_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX creator_commissions_order_idx ON commerce.creator_commissions USING btree (store_id, order_id);


--
-- Name: creator_payouts_creator_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX creator_payouts_creator_idx ON commerce.creator_payouts USING btree (store_id, creator_id, paid_on);


--
-- Name: creator_payouts_recorded_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX creator_payouts_recorded_by_idx ON commerce.creator_payouts USING btree (recorded_by);


--
-- Name: creator_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX creator_settings_updated_by_idx ON commerce.creator_settings USING btree (updated_by);


--
-- Name: creators_decided_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX creators_decided_by_idx ON commerce.creators USING btree (decided_by);


--
-- Name: credit_notes_invoice_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX credit_notes_invoice_idx ON commerce.credit_notes USING btree (store_id, invoice_id);


--
-- Name: credit_notes_issued_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX credit_notes_issued_idx ON commerce.credit_notes USING btree (store_id, issued_on);


--
-- Name: credit_notes_order_edit_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX credit_notes_order_edit_key ON commerce.credit_notes USING btree (store_id, order_edit_id) WHERE (source = 'order_edit'::text);


--
-- Name: credit_notes_return_exchange_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX credit_notes_return_exchange_key ON commerce.credit_notes USING btree (store_id, return_id) WHERE (source = 'return_exchange'::text);


--
-- Name: credit_notes_return_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX credit_notes_return_idx ON commerce.credit_notes USING btree (store_id, return_id);


--
-- Name: credit_notes_return_outside_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX credit_notes_return_outside_key ON commerce.credit_notes USING btree (store_id, return_id) WHERE (source = 'return_outside'::text);


--
-- Name: crm_moves_connected_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX crm_moves_connected_by_idx ON commerce.crm_moves USING btree (connected_by);


--
-- Name: css_versions_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX css_versions_created_by_idx ON commerce.css_versions USING btree (created_by);


--
-- Name: css_versions_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX css_versions_store_idx ON commerce.css_versions USING btree (store_id, created_at);


--
-- Name: custom_apps_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX custom_apps_created_by_idx ON commerce.custom_apps USING btree (created_by);


--
-- Name: customer_addresses_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_addresses_customer_idx ON commerce.customer_addresses USING btree (store_id, customer_id);


--
-- Name: customer_addresses_default_billing_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX customer_addresses_default_billing_idx ON commerce.customer_addresses USING btree (store_id, customer_id) WHERE is_default_billing;


--
-- Name: customer_addresses_default_shipping_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX customer_addresses_default_shipping_idx ON commerce.customer_addresses USING btree (store_id, customer_id) WHERE is_default_shipping;


--
-- Name: customer_codes_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_codes_email_idx ON commerce.customer_codes USING btree (store_id, lower(email), created_at);


--
-- Name: customer_companies_store_name_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX customer_companies_store_name_idx ON commerce.customer_companies USING btree (store_id, lower(name));


--
-- Name: customer_notes_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_notes_created_by_idx ON commerce.customer_notes USING btree (created_by);


--
-- Name: customer_notes_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_notes_email_idx ON commerce.customer_notes USING btree (store_id, email, created_at);


--
-- Name: customer_sessions_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_sessions_customer_idx ON commerce.customer_sessions USING btree (store_id, customer_id);


--
-- Name: customer_sign_in_links_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_sign_in_links_customer_idx ON commerce.customer_sign_in_links USING btree (store_id, customer_id);


--
-- Name: customer_tags_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_tags_created_by_idx ON commerce.customer_tags USING btree (created_by);


--
-- Name: customer_tags_key_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customer_tags_key_idx ON commerce.customer_tags USING btree (store_id, key);


--
-- Name: customer_tiers_store_name_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX customer_tiers_store_name_idx ON commerce.customer_tiers USING btree (store_id, lower(name));


--
-- Name: customers_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customers_company_idx ON commerce.customers USING btree (store_id, company_id);


--
-- Name: customers_copied_from_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX customers_copied_from_key ON commerce.customers USING btree (store_id, copied_from) WHERE (copied_from IS NOT NULL);


--
-- Name: customers_referred_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customers_referred_by_idx ON commerce.customers USING btree (store_id, referred_by_customer_id);


--
-- Name: customers_store_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX customers_store_email_idx ON commerce.customers USING btree (store_id, lower(email));


--
-- Name: customers_tier_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX customers_tier_idx ON commerce.customers USING btree (store_id, tier_id);


--
-- Name: data_job_assets_job_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX data_job_assets_job_idx ON commerce.data_job_assets USING btree (store_id, job_id);


--
-- Name: data_job_items_job_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX data_job_items_job_idx ON commerce.data_job_items USING btree (store_id, job_id, outcome);


--
-- Name: data_jobs_expires_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX data_jobs_expires_idx ON commerce.data_jobs USING btree (expires_at) WHERE ((purged_at IS NULL) AND (expires_at IS NOT NULL));


--
-- Name: data_jobs_one_active_customer_import_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX data_jobs_one_active_customer_import_idx ON commerce.data_jobs USING btree (store_id) WHERE ((kind = 'customer_import'::text) AND (status = ANY (ARRAY['uploaded'::text, 'checking'::text, 'checked'::text, 'queued'::text, 'running'::text])));


--
-- Name: data_jobs_one_active_import_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX data_jobs_one_active_import_idx ON commerce.data_jobs USING btree (store_id) WHERE ((kind = 'product_import'::text) AND (status = ANY (ARRAY['uploaded'::text, 'checking'::text, 'checked'::text, 'queued'::text, 'running'::text])));


--
-- Name: data_jobs_one_active_inventory_import_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX data_jobs_one_active_inventory_import_idx ON commerce.data_jobs USING btree (store_id) WHERE ((kind = 'inventory_import'::text) AND (status = ANY (ARRAY['uploaded'::text, 'checking'::text, 'checked'::text, 'queued'::text, 'running'::text])));


--
-- Name: data_jobs_one_active_order_history_import_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX data_jobs_one_active_order_history_import_idx ON commerce.data_jobs USING btree (store_id) WHERE ((kind = 'order_history_import'::text) AND (status = ANY (ARRAY['uploaded'::text, 'checking'::text, 'checked'::text, 'queued'::text, 'running'::text])));


--
-- Name: data_jobs_one_active_redirect_import_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX data_jobs_one_active_redirect_import_idx ON commerce.data_jobs USING btree (store_id) WHERE ((kind = 'redirect_import'::text) AND (status = ANY (ARRAY['uploaded'::text, 'checking'::text, 'checked'::text, 'queued'::text, 'running'::text])));


--
-- Name: data_jobs_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX data_jobs_open_idx ON commerce.data_jobs USING btree (status, claimed_until);


--
-- Name: data_jobs_requested_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX data_jobs_requested_by_idx ON commerce.data_jobs USING btree (requested_by);


--
-- Name: data_jobs_store_kind_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX data_jobs_store_kind_idx ON commerce.data_jobs USING btree (store_id, kind, created_at DESC NULLS LAST);


--
-- Name: deal_links_assignment_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX deal_links_assignment_key ON commerce.deal_links USING btree (store_id, assignment_id) WHERE (assignment_id IS NOT NULL);


--
-- Name: deal_links_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deal_links_created_by_idx ON commerce.deal_links USING btree (created_by);


--
-- Name: deal_links_deal_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deal_links_deal_idx ON commerce.deal_links USING btree (store_id, deal_id);


--
-- Name: deal_links_draft_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX deal_links_draft_key ON commerce.deal_links USING btree (store_id, draft_id) WHERE (draft_id IS NOT NULL);


--
-- Name: deal_links_order_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX deal_links_order_key ON commerce.deal_links USING btree (store_id, order_id) WHERE (order_id IS NOT NULL);


--
-- Name: deal_moves_deal_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deal_moves_deal_idx ON commerce.deal_moves USING btree (store_id, deal_id, at);


--
-- Name: deal_moves_moved_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deal_moves_moved_by_idx ON commerce.deal_moves USING btree (moved_by);


--
-- Name: deal_pipelines_name_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX deal_pipelines_name_key ON commerce.deal_pipelines USING btree (store_id, lower(name));


--
-- Name: deal_stages_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deal_stages_order_idx ON commerce.deal_stages USING btree (store_id, pipeline_id, "position");


--
-- Name: deal_stages_quote_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX deal_stages_quote_key ON commerce.deal_stages USING btree (store_id, pipeline_id) WHERE quote_stage;


--
-- Name: deals_board_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deals_board_idx ON commerce.deals USING btree (store_id, pipeline_id, status, stage_id);


--
-- Name: deals_closing_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deals_closing_idx ON commerce.deals USING btree (store_id, status, expected_close_on);


--
-- Name: deals_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deals_company_idx ON commerce.deals USING btree (store_id, company_id) WHERE (company_id IS NOT NULL);


--
-- Name: deals_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deals_created_by_idx ON commerce.deals USING btree (created_by);


--
-- Name: deals_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deals_customer_idx ON commerce.deals USING btree (store_id, customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: deals_owner_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deals_owner_idx ON commerce.deals USING btree (owner_id);


--
-- Name: deals_stage_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX deals_stage_idx ON commerce.deals USING btree (store_id, pipeline_id, stage_id);


--
-- Name: delivery_quotes_cart_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX delivery_quotes_cart_idx ON commerce.delivery_quotes USING btree (store_id, cart_id);


--
-- Name: delivery_quotes_expires_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX delivery_quotes_expires_idx ON commerce.delivery_quotes USING btree (expires_at);


--
-- Name: delivery_schedules_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX delivery_schedules_market_idx ON commerce.delivery_schedules USING btree (store_id, market_code, currency);


--
-- Name: design_preset_uses_applied_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_uses_applied_by_idx ON commerce.design_preset_uses USING btree (applied_by);


--
-- Name: design_preset_uses_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_uses_install_idx ON commerce.design_preset_uses USING btree (install_id);


--
-- Name: design_preset_uses_preset_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_uses_preset_idx ON commerce.design_preset_uses USING btree (preset_id);


--
-- Name: design_preset_uses_previous_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_uses_previous_install_idx ON commerce.design_preset_uses USING btree (previous_install_id);


--
-- Name: design_preset_uses_restored_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_uses_restored_by_idx ON commerce.design_preset_uses USING btree (restored_by);


--
-- Name: design_preset_uses_saved_theme_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_uses_saved_theme_idx ON commerce.design_preset_uses USING btree (saved_theme_id);


--
-- Name: design_preset_uses_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_uses_store_idx ON commerce.design_preset_uses USING btree (store_id, applied_at);


--
-- Name: design_preset_versions_number_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX design_preset_versions_number_idx ON commerce.design_preset_versions USING btree (preset_id, number);


--
-- Name: design_preset_versions_published_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_preset_versions_published_by_idx ON commerce.design_preset_versions USING btree (published_by);


--
-- Name: design_presets_archived_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_presets_archived_by_idx ON commerce.design_presets USING btree (archived_by);


--
-- Name: design_presets_author_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_presets_author_idx ON commerce.design_presets USING btree (author_id);


--
-- Name: design_presets_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_presets_created_by_idx ON commerce.design_presets USING btree (created_by);


--
-- Name: design_presets_launch_key_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX design_presets_launch_key_idx ON commerce.design_presets USING btree (launch_key);


--
-- Name: design_presets_offered_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_presets_offered_idx ON commerce.design_presets USING btree (published, "position");


--
-- Name: design_presets_slug_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX design_presets_slug_idx ON commerce.design_presets USING btree (slug);


--
-- Name: design_presets_source_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_presets_source_store_idx ON commerce.design_presets USING btree (source_store_id);


--
-- Name: design_presets_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_presets_updated_by_idx ON commerce.design_presets USING btree (updated_by);


--
-- Name: design_presets_workspace_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX design_presets_workspace_idx ON commerce.design_presets USING btree (workspace_store_id);


--
-- Name: design_variations_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_variations_created_by_idx ON commerce.design_variations USING btree (created_by);


--
-- Name: design_variations_key_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX design_variations_key_idx ON commerce.design_variations USING btree (preset_id, key);


--
-- Name: design_variations_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX design_variations_updated_by_idx ON commerce.design_variations USING btree (updated_by);


--
-- Name: discount_code_items_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX discount_code_items_customer_idx ON commerce.discount_code_items USING btree (customer_id);


--
-- Name: discount_code_items_discount_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX discount_code_items_discount_idx ON commerce.discount_code_items USING btree (store_id, discount_id, batch);


--
-- Name: discount_codes_segment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX discount_codes_segment_idx ON commerce.discount_codes USING btree (store_id, segment_id);


--
-- Name: dispute_evidence_saved_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dispute_evidence_saved_by_idx ON commerce.dispute_evidence USING btree (saved_by);


--
-- Name: dispute_evidence_submitted_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dispute_evidence_submitted_by_idx ON commerce.dispute_evidence USING btree (submitted_by);


--
-- Name: dns_changes_actor_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dns_changes_actor_idx ON commerce.dns_changes USING btree (actor_id);


--
-- Name: dns_changes_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dns_changes_store_idx ON commerce.dns_changes USING btree (store_id, created_at);


--
-- Name: dns_changes_undo_of_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dns_changes_undo_of_idx ON commerce.dns_changes USING btree (undo_of);


--
-- Name: dns_changes_zone_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dns_changes_zone_idx ON commerce.dns_changes USING btree (zone_id, created_at);


--
-- Name: dns_zones_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dns_zones_account_idx ON commerce.dns_zones USING btree (account_id);


--
-- Name: dns_zones_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dns_zones_created_by_idx ON commerce.dns_zones USING btree (created_by);


--
-- Name: dns_zones_live_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX dns_zones_live_idx ON commerce.dns_zones USING btree (apex) WHERE (status <> 'left'::text);


--
-- Name: dns_zones_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dns_zones_store_idx ON commerce.dns_zones USING btree (store_id);


--
-- Name: docs_feedback_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_feedback_created_idx ON commerce.docs_feedback USING btree (created_at);


--
-- Name: docs_feedback_path_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_feedback_path_idx ON commerce.docs_feedback USING btree (path, created_at);


--
-- Name: docs_guide_conversations_ended_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_guide_conversations_ended_idx ON commerce.docs_guide_conversations USING btree (ended_at) WHERE (anonymised_at IS NULL);


--
-- Name: docs_guide_conversations_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_guide_conversations_open_idx ON commerce.docs_guide_conversations USING btree (last_message_at) WHERE (ended_at IS NULL);


--
-- Name: docs_guide_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_guide_updated_by_idx ON commerce.docs_guide USING btree (updated_by);


--
-- Name: docs_index_doc_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_index_doc_idx ON commerce.docs_index USING btree (doc, "position");


--
-- Name: docs_index_search_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_index_search_idx ON commerce.docs_index USING gin (search);


--
-- Name: docs_index_space_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_index_space_idx ON commerce.docs_index USING btree (space);


--
-- Name: docs_index_trgm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_index_trgm_idx ON commerce.docs_index USING gin (trgm extensions.gin_trgm_ops);


--
-- Name: docs_index_words_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_index_words_idx ON commerce.docs_index USING gin (words);


--
-- Name: docs_reads_day_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_reads_day_idx ON commerce.docs_reads USING btree (day);


--
-- Name: docs_search_misses_last_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX docs_search_misses_last_idx ON commerce.docs_search_misses USING btree (last_at);


--
-- Name: document_deliveries_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX document_deliveries_email_idx ON commerce.document_deliveries USING btree (email_message_id);


--
-- Name: domain_pricing_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_pricing_updated_by_idx ON commerce.domain_pricing USING btree (updated_by);


--
-- Name: domain_purchases_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_purchases_account_idx ON commerce.domain_purchases USING btree (account_id);


--
-- Name: domain_purchases_chosen_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_purchases_chosen_by_idx ON commerce.domain_purchases USING btree (chosen_by);


--
-- Name: domain_purchases_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX domain_purchases_open_idx ON commerce.domain_purchases USING btree (apex, kind) WHERE (status = ANY (ARRAY['quoted'::text, 'invoiced'::text, 'paid'::text, 'registering'::text]));


--
-- Name: domain_purchases_registrant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_purchases_registrant_idx ON commerce.domain_purchases USING btree (registrant_id);


--
-- Name: domain_purchases_registration_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_purchases_registration_idx ON commerce.domain_purchases USING btree (registration_id);


--
-- Name: domain_purchases_reviewed_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_purchases_reviewed_by_idx ON commerce.domain_purchases USING btree (reviewed_by);


--
-- Name: domain_purchases_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_purchases_store_idx ON commerce.domain_purchases USING btree (store_id, created_at);


--
-- Name: domain_purchases_work_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_purchases_work_idx ON commerce.domain_purchases USING btree (status, next_try_at) WHERE (status = ANY (ARRAY['quoted'::text, 'paid'::text, 'registering'::text, 'failed'::text]));


--
-- Name: domain_registrants_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrants_account_idx ON commerce.domain_registrants USING btree (account_id);


--
-- Name: domain_registrants_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrants_created_by_idx ON commerce.domain_registrants USING btree (created_by);


--
-- Name: domain_registrants_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrants_store_idx ON commerce.domain_registrants USING btree (store_id);


--
-- Name: domain_registrations_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrations_account_idx ON commerce.domain_registrations USING btree (account_id);


--
-- Name: domain_registrations_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrations_created_by_idx ON commerce.domain_registrations USING btree (created_by);


--
-- Name: domain_registrations_expiry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrations_expiry_idx ON commerce.domain_registrations USING btree (expires_at) WHERE (status = 'active'::text);


--
-- Name: domain_registrations_live_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX domain_registrations_live_idx ON commerce.domain_registrations USING btree (apex) WHERE (status <> 'transferred_out'::text);


--
-- Name: domain_registrations_registrant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrations_registrant_idx ON commerce.domain_registrations USING btree (registrant_id);


--
-- Name: domain_registrations_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX domain_registrations_store_idx ON commerce.domain_registrations USING btree (store_id);


--
-- Name: draft_order_lines_draft_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_order_lines_draft_idx ON commerce.draft_order_lines USING btree (store_id, draft_id, "position");


--
-- Name: draft_order_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_order_lines_variant_idx ON commerce.draft_order_lines USING btree (store_id, variant_id);


--
-- Name: draft_order_lines_vat_category_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_order_lines_vat_category_idx ON commerce.draft_order_lines USING btree (vat_category);


--
-- Name: draft_orders_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_orders_created_by_idx ON commerce.draft_orders USING btree (created_by);


--
-- Name: draft_orders_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_orders_customer_idx ON commerce.draft_orders USING btree (store_id, customer_id);


--
-- Name: draft_orders_expiry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_orders_expiry_idx ON commerce.draft_orders USING btree (expires_at) WHERE (status = 'sent'::text);


--
-- Name: draft_orders_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_orders_market_idx ON commerce.draft_orders USING btree (store_id, market_code);


--
-- Name: draft_orders_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_orders_order_idx ON commerce.draft_orders USING btree (store_id, order_id);


--
-- Name: draft_orders_quote_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_orders_quote_idx ON commerce.draft_orders USING btree (store_id, created_at DESC NULLS LAST) WHERE (source = 'quote'::text);


--
-- Name: draft_orders_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX draft_orders_store_idx ON commerce.draft_orders USING btree (store_id, status, updated_at DESC NULLS LAST);


--
-- Name: draft_orders_token_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX draft_orders_token_idx ON commerce.draft_orders USING btree (pay_token_hash) WHERE (pay_token_hash IS NOT NULL);


--
-- Name: dream_runs_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dream_runs_account_idx ON commerce.dream_runs USING btree (account_id);


--
-- Name: dream_runs_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dream_runs_conversation_idx ON commerce.dream_runs USING btree (conversation_id);


--
-- Name: dream_runs_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dream_runs_due_idx ON commerce.dream_runs USING btree (claimed_until) WHERE (finished_at IS NULL);


--
-- Name: dream_runs_one_open; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX dream_runs_one_open ON commerce.dream_runs USING btree (store_id) WHERE ((finished_at IS NULL) AND (status <> 'stopped'::text));


--
-- Name: dream_runs_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX dream_runs_store_idx ON commerce.dream_runs USING btree (store_id, created_at);


--
-- Name: duty_rates_destination_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX duty_rates_destination_idx ON commerce.duty_rates USING btree (destination, hs_prefix);


--
-- Name: duty_rates_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX duty_rates_updated_by_idx ON commerce.duty_rates USING btree (updated_by);


--
-- Name: einvoice_sends_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX einvoice_sends_due_idx ON commerce.einvoice_sends USING btree (next_attempt_at) WHERE (state = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: einvoice_sends_message_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX einvoice_sends_message_key ON commerce.einvoice_sends USING btree (access_point, message_id) WHERE (message_id IS NOT NULL);


--
-- Name: email_filing_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX email_filing_key ON commerce.email_filing USING btree (key);


--
-- Name: email_messages_idempotency_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX email_messages_idempotency_idx ON commerce.email_messages USING btree (idempotency_key);


--
-- Name: email_messages_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX email_messages_order_idx ON commerce.email_messages USING btree (store_id, order_id);


--
-- Name: email_messages_provider_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX email_messages_provider_idx ON commerce.email_messages USING btree (provider_reference);


--
-- Name: email_messages_store_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX email_messages_store_created_idx ON commerce.email_messages USING btree (store_id, created_at);


--
-- Name: email_messages_subscription_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX email_messages_subscription_idx ON commerce.email_messages USING btree (store_id, subscription_id);


--
-- Name: email_opt_outs_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX email_opt_outs_email_idx ON commerce.email_opt_outs USING btree (store_id, lower(email));


--
-- Name: email_templates_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX email_templates_updated_by_idx ON commerce.email_templates USING btree (updated_by);


--
-- Name: experiment_carts_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiment_carts_created_idx ON commerce.experiment_carts USING btree (created_at);


--
-- Name: experiment_carts_visitor_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiment_carts_visitor_idx ON commerce.experiment_carts USING btree (store_id, visitor);


--
-- Name: experiment_events_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiment_events_store_idx ON commerce.experiment_events USING btree (store_id, occurred_at);


--
-- Name: experiment_exposures_seen_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiment_exposures_seen_idx ON commerce.experiment_exposures USING btree (store_id, first_seen);


--
-- Name: experiment_exposures_visitor_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiment_exposures_visitor_idx ON commerce.experiment_exposures USING btree (store_id, visitor);


--
-- Name: experiment_variants_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiment_variants_page_idx ON commerce.experiment_variants USING btree (store_id, page_id);


--
-- Name: experiment_variants_page_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX experiment_variants_page_key ON commerce.experiment_variants USING btree (page_id) WHERE (page_id IS NOT NULL);


--
-- Name: experiments_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiments_created_by_idx ON commerce.experiments USING btree (created_by);


--
-- Name: experiments_running_target_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX experiments_running_target_key ON commerce.experiments USING btree (store_id, target_page_id) WHERE (status = 'running'::text);


--
-- Name: experiments_store_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiments_store_status_idx ON commerce.experiments USING btree (store_id, status);


--
-- Name: experiments_target_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiments_target_idx ON commerce.experiments USING btree (store_id, target_page_id);


--
-- Name: experiments_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX experiments_updated_by_idx ON commerce.experiments USING btree (updated_by);


--
-- Name: field_search_search_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX field_search_search_idx ON commerce.field_search USING gin (search);


--
-- Name: fiken_connections_company_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX fiken_connections_company_key ON commerce.fiken_connections USING btree (company_slug);


--
-- Name: fiken_connections_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX fiken_connections_updated_by_idx ON commerce.fiken_connections USING btree (updated_by);


--
-- Name: fiken_sync_attach_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX fiken_sync_attach_idx ON commerce.fiken_sync USING btree (store_id, synced_at) WHERE ((attached_at IS NULL) AND (state = 'synced'::text) AND (kind = ANY (ARRAY['shop_invoice'::text, 'shop_credit_note'::text])));


--
-- Name: fiken_sync_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX fiken_sync_due_idx ON commerce.fiken_sync USING btree (store_id, state, next_attempt_at) WHERE (state = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: fiken_sync_external_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX fiken_sync_external_key ON commerce.fiken_sync USING btree (store_id, company_slug, external_key) WHERE (external_key IS NOT NULL);


--
-- Name: filed_emails_addresses_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX filed_emails_addresses_idx ON commerce.filed_emails USING gin (addresses);


--
-- Name: filed_emails_companies_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX filed_emails_companies_idx ON commerce.filed_emails USING gin (company_ids);


--
-- Name: filed_emails_customers_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX filed_emails_customers_idx ON commerce.filed_emails USING gin (customer_ids);


--
-- Name: filed_emails_deals_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX filed_emails_deals_idx ON commerce.filed_emails USING gin (deal_ids);


--
-- Name: filed_emails_filed_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX filed_emails_filed_by_idx ON commerce.filed_emails USING btree (filed_by);


--
-- Name: filed_emails_message_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX filed_emails_message_key ON commerce.filed_emails USING btree (store_id, message_id) WHERE (message_id IS NOT NULL);


--
-- Name: filed_emails_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX filed_emails_store_idx ON commerce.filed_emails USING btree (store_id, created_at);


--
-- Name: form_submissions_block_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX form_submissions_block_idx ON commerce.form_submissions USING btree (store_id, block_id, created_at);


--
-- Name: form_submissions_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX form_submissions_created_idx ON commerce.form_submissions USING btree (created_at);


--
-- Name: form_submissions_token_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX form_submissions_token_idx ON commerce.form_submissions USING btree (token_hash);


--
-- Name: form_submissions_visitor_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX form_submissions_visitor_idx ON commerce.form_submissions USING btree (visitor, created_at);


--
-- Name: gift_card_entries_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_card_entries_account_idx ON commerce.gift_card_entries USING btree (account_id);


--
-- Name: gift_card_entries_card_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_card_entries_card_idx ON commerce.gift_card_entries USING btree (store_id, card_id, created_at);


--
-- Name: gift_card_entries_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_card_entries_order_idx ON commerce.gift_card_entries USING btree (store_id, order_id) WHERE (order_id IS NOT NULL);


--
-- Name: gift_cards_code_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX gift_cards_code_key ON commerce.gift_cards USING btree (store_id, code_hash) WHERE (code_hash IS NOT NULL);


--
-- Name: gift_cards_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_cards_customer_idx ON commerce.gift_cards USING btree (store_id, customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: gift_cards_deactivated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_cards_deactivated_by_idx ON commerce.gift_cards USING btree (deactivated_by);


--
-- Name: gift_cards_issued_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_cards_issued_by_idx ON commerce.gift_cards USING btree (issued_by);


--
-- Name: gift_cards_moved_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX gift_cards_moved_key ON commerce.gift_cards USING btree (store_id, moved_from) WHERE (moved_from IS NOT NULL);


--
-- Name: gift_cards_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_cards_order_idx ON commerce.gift_cards USING btree (store_id, order_id) WHERE (order_id IS NOT NULL);


--
-- Name: gift_cards_order_line_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX gift_cards_order_line_key ON commerce.gift_cards USING btree (store_id, order_line_id, unit_index) WHERE (order_line_id IS NOT NULL);


--
-- Name: gift_cards_refund_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX gift_cards_refund_key ON commerce.gift_cards USING btree (store_id, refund_id) WHERE (refund_id IS NOT NULL);


--
-- Name: gift_cards_to_send_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX gift_cards_to_send_idx ON commerce.gift_cards USING btree (send_at) WHERE ((sent_at IS NULL) AND (code_hash IS NOT NULL));


--
-- Name: google_places_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX google_places_updated_by_idx ON commerce.google_places USING btree (updated_by);


--
-- Name: host_commissions_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX host_commissions_due_idx ON commerce.host_commissions USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: host_commissions_host_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX host_commissions_host_idx ON commerce.host_commissions USING btree (store_id, host_id);


--
-- Name: host_commissions_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX host_commissions_order_idx ON commerce.host_commissions USING btree (store_id, order_id);


--
-- Name: host_stripe_accounts_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX host_stripe_accounts_store_idx ON commerce.host_stripe_accounts USING btree (store_id, host_id);


--
-- Name: host_tax_details_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX host_tax_details_store_idx ON commerce.host_tax_details USING btree (store_id, host_id);


--
-- Name: hosts_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX hosts_account_idx ON commerce.hosts USING btree (account_id);


--
-- Name: hosts_invited_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX hosts_invited_by_idx ON commerce.hosts USING btree (invited_by);


--
-- Name: house_customer_links_account_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX house_customer_links_account_key ON commerce.house_customer_links USING btree (account_id) WHERE (account_id IS NOT NULL);


--
-- Name: house_customer_links_deal_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX house_customer_links_deal_key ON commerce.house_customer_links USING btree (store_id, deal_id) WHERE (deal_id IS NOT NULL);


--
-- Name: house_customer_links_request_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX house_customer_links_request_key ON commerce.house_customer_links USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: instagram_accounts_connected_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX instagram_accounts_connected_by_idx ON commerce.instagram_accounts USING btree (connected_by);


--
-- Name: integration_deliveries_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX integration_deliveries_due_idx ON commerce.integration_deliveries USING btree (next_attempt_at) WHERE (status = 'pending'::text);


--
-- Name: integration_deliveries_endpoint_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX integration_deliveries_endpoint_idx ON commerce.integration_deliveries USING btree (endpoint_id, created_at);


--
-- Name: integration_deliveries_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX integration_deliveries_store_idx ON commerce.integration_deliveries USING btree (store_id, provider, created_at);


--
-- Name: integration_deliveries_unbuilt_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX integration_deliveries_unbuilt_idx ON commerce.integration_deliveries USING btree (endpoint_id, subject_id, event) WHERE ((status = 'pending'::text) AND (payload IS NULL));


--
-- Name: inventory_levels_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_levels_location_idx ON commerce.inventory_levels USING btree (store_id, location_id);


--
-- Name: inventory_levels_store_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_levels_store_variant_idx ON commerce.inventory_levels USING btree (store_id, variant_id);


--
-- Name: inventory_locations_active_name_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX inventory_locations_active_name_key ON commerce.inventory_locations USING btree (store_id, lower(name)) WHERE active;


--
-- Name: inventory_locations_store_supplier_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_locations_store_supplier_idx ON commerce.inventory_locations USING btree (store_id, supplier_id) WHERE (supplier_id IS NOT NULL);


--
-- Name: inventory_locations_supplier_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX inventory_locations_supplier_key ON commerce.inventory_locations USING btree (supplier_id) WHERE (supplier_id IS NOT NULL);


--
-- Name: inventory_movements_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_movements_created_idx ON commerce.inventory_movements USING btree (store_id, created_at DESC NULLS LAST);


--
-- Name: inventory_movements_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_movements_location_idx ON commerce.inventory_movements USING btree (store_id, location_id);


--
-- Name: inventory_movements_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_movements_order_idx ON commerce.inventory_movements USING btree (store_id, order_id) WHERE (order_id IS NOT NULL);


--
-- Name: inventory_movements_return_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_movements_return_idx ON commerce.inventory_movements USING btree (store_id, return_id) WHERE (return_id IS NOT NULL);


--
-- Name: inventory_movements_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_movements_variant_idx ON commerce.inventory_movements USING btree (store_id, variant_id, id DESC NULLS LAST);


--
-- Name: inventory_reservations_active_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_reservations_active_idx ON commerce.inventory_reservations USING btree (variant_id, location_id) WHERE (released_at IS NULL);


--
-- Name: inventory_reservations_cart_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_reservations_cart_idx ON commerce.inventory_reservations USING btree (store_id, cart_id);


--
-- Name: inventory_reservations_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_reservations_location_idx ON commerce.inventory_reservations USING btree (store_id, location_id);


--
-- Name: inventory_reservations_order_edit_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_reservations_order_edit_idx ON commerce.inventory_reservations USING btree (store_id, order_edit_id) WHERE (order_edit_id IS NOT NULL);


--
-- Name: inventory_reservations_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_reservations_order_idx ON commerce.inventory_reservations USING btree (store_id, order_id);


--
-- Name: inventory_reservations_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX inventory_reservations_variant_idx ON commerce.inventory_reservations USING btree (store_id, variant_id);


--
-- Name: invoice_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX invoice_settings_updated_by_idx ON commerce.invoice_settings USING btree (updated_by);


--
-- Name: invoices_issued_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX invoices_issued_idx ON commerce.invoices USING btree (store_id, issued_on);


--
-- Name: invoices_order_edit_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX invoices_order_edit_key ON commerce.invoices USING btree (store_id, order_edit_id) WHERE (kind = 'order_edit'::text);


--
-- Name: invoices_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX invoices_order_idx ON commerce.invoices USING btree (store_id, order_id);


--
-- Name: invoices_original_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX invoices_original_key ON commerce.invoices USING btree (store_id, order_id) WHERE (kind = 'order'::text);


--
-- Name: invoices_supply_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX invoices_supply_idx ON commerce.invoices USING btree (store_id, supply_date);


--
-- Name: kaizen_life_accounts_account_live_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX kaizen_life_accounts_account_live_key ON commerce.kaizen_life_accounts USING btree (account_id) WHERE (unlinked_at IS NULL);


--
-- Name: kaizen_life_accounts_life_live_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX kaizen_life_accounts_life_live_key ON commerce.kaizen_life_accounts USING btree (life_user_id) WHERE (unlinked_at IS NULL);


--
-- Name: kaizen_life_accounts_pair_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX kaizen_life_accounts_pair_key ON commerce.kaizen_life_accounts USING btree (account_id, life_user_id);


--
-- Name: kaizen_life_handoffs_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX kaizen_life_handoffs_account_idx ON commerce.kaizen_life_handoffs USING btree (account_id, direction, created_at);


--
-- Name: kaizen_life_handoffs_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX kaizen_life_handoffs_conversation_idx ON commerce.kaizen_life_handoffs USING btree (conversation_id);


--
-- Name: kaizen_life_handoffs_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX kaizen_life_handoffs_open_idx ON commerce.kaizen_life_handoffs USING btree (status, updated_at) WHERE (status = ANY (ARRAY['working'::text, 'waiting_for_you'::text]));


--
-- Name: kaizen_life_handoffs_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX kaizen_life_handoffs_store_idx ON commerce.kaizen_life_handoffs USING btree (store_id);


--
-- Name: kaizen_life_jtis_expires_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX kaizen_life_jtis_expires_idx ON commerce.kaizen_life_jtis USING btree (expires_at);


--
-- Name: knowledge_chunks_document_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX knowledge_chunks_document_idx ON commerce.knowledge_chunks USING btree (document_id);


--
-- Name: knowledge_chunks_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX knowledge_chunks_entry_idx ON commerce.knowledge_chunks USING btree (entry_id, locale);


--
-- Name: knowledge_chunks_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX knowledge_chunks_page_idx ON commerce.knowledge_chunks USING btree (page_id, locale);


--
-- Name: knowledge_chunks_search_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX knowledge_chunks_search_idx ON commerce.knowledge_chunks USING gin (search);


--
-- Name: knowledge_chunks_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX knowledge_chunks_store_idx ON commerce.knowledge_chunks USING btree (store_id, space);


--
-- Name: knowledge_documents_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX knowledge_documents_created_by_idx ON commerce.knowledge_documents USING btree (created_by);


--
-- Name: knowledge_documents_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX knowledge_documents_store_idx ON commerce.knowledge_documents USING btree (store_id);


--
-- Name: lead_decisions_decided_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX lead_decisions_decided_by_idx ON commerce.lead_decisions USING btree (decided_by);


--
-- Name: lead_decisions_email_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX lead_decisions_email_key ON commerce.lead_decisions USING btree (store_id, email);


--
-- Name: ledger_accounts_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_accounts_store_book_idx ON commerce.ledger_accounts USING btree (store_id, book_id);


--
-- Name: ledger_books_locked_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_books_locked_by_idx ON commerce.ledger_books USING btree (locked_by);


--
-- Name: ledger_books_open_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX ledger_books_open_key ON commerce.ledger_books USING btree (store_id) WHERE (closed_on IS NULL);


--
-- Name: ledger_books_opened_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_books_opened_by_idx ON commerce.ledger_books USING btree (opened_by);


--
-- Name: ledger_budgets_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX ledger_budgets_key ON commerce.ledger_budgets USING btree (book_id, year, account);


--
-- Name: ledger_budgets_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_budgets_store_idx ON commerce.ledger_budgets USING btree (store_id);


--
-- Name: ledger_budgets_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_budgets_updated_by_idx ON commerce.ledger_budgets USING btree (updated_by);


--
-- Name: ledger_comparisons_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_comparisons_store_book_idx ON commerce.ledger_comparisons USING btree (store_id, book_id);


--
-- Name: ledger_counters_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_counters_store_book_idx ON commerce.ledger_counters USING btree (store_id, book_id);


--
-- Name: ledger_entries_date_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_entries_date_idx ON commerce.ledger_entries USING btree (book_id, entry_date);


--
-- Name: ledger_entries_posted_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_entries_posted_by_idx ON commerce.ledger_entries USING btree (posted_by);


--
-- Name: ledger_entries_reversed_once; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX ledger_entries_reversed_once ON commerce.ledger_entries USING btree (reverses) WHERE (reverses IS NOT NULL);


--
-- Name: ledger_entries_source_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_entries_source_idx ON commerce.ledger_entries USING btree (book_id, source_kind, source_id) WHERE (source_kind IS NOT NULL);


--
-- Name: ledger_entries_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_entries_store_book_idx ON commerce.ledger_entries USING btree (store_id, book_id);


--
-- Name: ledger_lines_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_lines_account_idx ON commerce.ledger_lines USING btree (book_id, account);


--
-- Name: ledger_lines_store_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_lines_store_entry_idx ON commerce.ledger_lines USING btree (store_id, entry_id);


--
-- Name: ledger_vouchers_bank_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_vouchers_bank_line_idx ON commerce.ledger_vouchers USING btree (store_id, bank_line_id);


--
-- Name: ledger_vouchers_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_vouchers_book_idx ON commerce.ledger_vouchers USING btree (store_id, book_id);


--
-- Name: ledger_vouchers_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_vouchers_entry_idx ON commerce.ledger_vouchers USING btree (store_id, entry_id);


--
-- Name: ledger_vouchers_uploaded_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_vouchers_uploaded_by_idx ON commerce.ledger_vouchers USING btree (uploaded_by);


--
-- Name: ledger_waiting_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX ledger_waiting_store_book_idx ON commerce.ledger_waiting USING btree (store_id, book_id);


--
-- Name: legal_ai_settings_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_ai_settings_account_idx ON commerce.legal_ai_settings USING btree (turned_on_by);


--
-- Name: legal_ai_writes_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_ai_writes_account_idx ON commerce.legal_ai_writes USING btree (account_id);


--
-- Name: legal_ai_writes_active_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX legal_ai_writes_active_idx ON commerce.legal_ai_writes USING btree (store_id, role) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: legal_ai_writes_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_ai_writes_page_idx ON commerce.legal_ai_writes USING btree (page_id);


--
-- Name: legal_ai_writes_queue_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_ai_writes_queue_idx ON commerce.legal_ai_writes USING btree (status, created_at);


--
-- Name: legal_ai_writes_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_ai_writes_store_idx ON commerce.legal_ai_writes USING btree (store_id, role, created_at);


--
-- Name: legal_snapshots_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_snapshots_store_idx ON commerce.legal_snapshots USING btree (store_id);


--
-- Name: legal_source_reads_source_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_source_reads_source_idx ON commerce.legal_source_reads USING btree (source_key, language, read_at);


--
-- Name: legal_source_reads_text_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX legal_source_reads_text_idx ON commerce.legal_source_reads USING btree (text_hash);


--
-- Name: limit_overrides_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX limit_overrides_account_idx ON commerce.limit_overrides USING btree (account_id);


--
-- Name: limit_overrides_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX limit_overrides_created_by_idx ON commerce.limit_overrides USING btree (created_by);


--
-- Name: live_drills_requested_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX live_drills_requested_by_idx ON commerce.live_drills USING btree (requested_by);


--
-- Name: live_drills_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX live_drills_store_idx ON commerce.live_drills USING btree (store_id, requested_at);


--
-- Name: local_delivery_areas_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX local_delivery_areas_location_idx ON commerce.local_delivery_areas USING btree (store_id, location_id);


--
-- Name: local_delivery_areas_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX local_delivery_areas_market_idx ON commerce.local_delivery_areas USING btree (store_id, market_code, currency);


--
-- Name: look_versions_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX look_versions_created_by_idx ON commerce.look_versions USING btree (created_by);


--
-- Name: look_versions_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX look_versions_store_idx ON commerce.look_versions USING btree (store_id, created_at);


--
-- Name: market_availability_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX market_availability_product_idx ON commerce.market_availability USING btree (store_id, product_id, market_code);


--
-- Name: marketing_consent_events_subscriber_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketing_consent_events_subscriber_idx ON commerce.marketing_consent_events USING btree (store_id, subscriber_id, created_at);


--
-- Name: marketing_subscribers_confirm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX marketing_subscribers_confirm_idx ON commerce.marketing_subscribers USING btree (confirm_hash);


--
-- Name: marketing_subscribers_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketing_subscribers_customer_idx ON commerce.marketing_subscribers USING btree (store_id, customer_id);


--
-- Name: marketing_subscribers_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX marketing_subscribers_email_idx ON commerce.marketing_subscribers USING btree (store_id, lower(email));


--
-- Name: marketing_subscribers_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketing_subscribers_list_idx ON commerce.marketing_subscribers USING btree (store_id, status, created_at);


--
-- Name: marketing_subscribers_pending_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketing_subscribers_pending_idx ON commerce.marketing_subscribers USING btree (confirm_until) WHERE (status = 'pending'::text);


--
-- Name: marketing_subscribers_token_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX marketing_subscribers_token_idx ON commerce.marketing_subscribers USING btree (token);


--
-- Name: marketplace_connections_channel_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX marketplace_connections_channel_key ON commerce.marketplace_connections USING btree (store_id, channel);


--
-- Name: marketplace_connections_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketplace_connections_updated_by_idx ON commerce.marketplace_connections USING btree (updated_by);


--
-- Name: marketplace_listings_connection_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketplace_listings_connection_idx ON commerce.marketplace_listings USING btree (store_id, connection_id);


--
-- Name: marketplace_listings_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketplace_listings_variant_idx ON commerce.marketplace_listings USING btree (store_id, variant_id);


--
-- Name: marketplace_orders_connection_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketplace_orders_connection_idx ON commerce.marketplace_orders USING btree (store_id, connection_id);


--
-- Name: marketplace_orders_external_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX marketplace_orders_external_key ON commerce.marketplace_orders USING btree (connection_id, external_id);


--
-- Name: marketplace_orders_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX marketplace_orders_store_idx ON commerce.marketplace_orders USING btree (store_id, placed_at DESC NULLS LAST);


--
-- Name: markets_code_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX markets_code_idx ON commerce.markets USING btree (code);


--
-- Name: media_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX media_created_by_idx ON commerce.media USING btree (created_by);


--
-- Name: media_edited_from_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX media_edited_from_idx ON commerce.media USING btree (edited_from);


--
-- Name: media_embeddings_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX media_embeddings_store_idx ON commerce.media_embeddings USING btree (store_id, space);


--
-- Name: media_file_name_trgm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX media_file_name_trgm_idx ON commerce.media USING gin (lower(file_name) extensions.gin_trgm_ops);


--
-- Name: media_search_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX media_search_idx ON commerce.media USING gin (search);


--
-- Name: media_store_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX media_store_created_idx ON commerce.media USING btree (store_id, created_at);


--
-- Name: media_thumbnail_url_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX media_thumbnail_url_idx ON commerce.media USING btree (thumbnail_url);


--
-- Name: menus_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX menus_created_by_idx ON commerce.menus USING btree (created_by);


--
-- Name: menus_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX menus_updated_by_idx ON commerce.menus USING btree (updated_by);


--
-- Name: mollie_connections_connected_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX mollie_connections_connected_by_idx ON commerce.mollie_connections USING btree (connected_by);


--
-- Name: not_found_hits_day_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX not_found_hits_day_idx ON commerce.not_found_hits USING btree (day);


--
-- Name: not_found_ignored_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX not_found_ignored_created_by_idx ON commerce.not_found_ignored USING btree (created_by);


--
-- Name: notification_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX notification_settings_updated_by_idx ON commerce.notification_settings USING btree (updated_by);


--
-- Name: oauth_grants_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_grants_account_idx ON commerce.oauth_grants USING btree (account_id);


--
-- Name: oauth_grants_app_store_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX oauth_grants_app_store_key ON commerce.oauth_grants USING btree (client_id, store_id) WHERE ((revoked_at IS NULL) AND (resource = 'admin'::text));


--
-- Name: oauth_grants_client_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_grants_client_idx ON commerce.oauth_grants USING btree (client_id);


--
-- Name: oauth_grants_live_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX oauth_grants_live_key ON commerce.oauth_grants USING btree (account_id, client_id, resource) WHERE ((revoked_at IS NULL) AND (resource = 'mcp'::text));


--
-- Name: oauth_grants_store_ids_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_grants_store_ids_idx ON commerce.oauth_grants USING gin (store_ids);


--
-- Name: oauth_grants_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_grants_store_idx ON commerce.oauth_grants USING btree (store_id);


--
-- Name: oauth_store_cutoffs_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_store_cutoffs_account_idx ON commerce.oauth_store_cutoffs USING btree (account_id, client_id);


--
-- Name: oauth_store_cutoffs_client_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_store_cutoffs_client_idx ON commerce.oauth_store_cutoffs USING btree (client_id);


--
-- Name: oauth_store_cutoffs_cut_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_store_cutoffs_cut_by_idx ON commerce.oauth_store_cutoffs USING btree (cut_by);


--
-- Name: oauth_tokens_expires_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_tokens_expires_idx ON commerce.oauth_tokens USING btree (expires_at);


--
-- Name: oauth_tokens_family_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_tokens_family_idx ON commerce.oauth_tokens USING btree (family);


--
-- Name: oauth_tokens_grant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX oauth_tokens_grant_idx ON commerce.oauth_tokens USING btree (grant_id);


--
-- Name: old_shops_read_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX old_shops_read_by_idx ON commerce.old_shops USING btree (read_by);


--
-- Name: order_discount_codes_discount_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_discount_codes_discount_idx ON commerce.order_discount_codes USING btree (store_id, discount_id);


--
-- Name: order_discount_codes_item_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_discount_codes_item_idx ON commerce.order_discount_codes USING btree (store_id, item_id) WHERE (item_id IS NOT NULL);


--
-- Name: order_downloads_file_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_downloads_file_idx ON commerce.order_downloads USING btree (store_id, file_id);


--
-- Name: order_downloads_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_downloads_order_idx ON commerce.order_downloads USING btree (store_id, order_id);


--
-- Name: order_edit_lines_edit_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edit_lines_edit_idx ON commerce.order_edit_lines USING btree (store_id, order_edit_id);


--
-- Name: order_edit_lines_order_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edit_lines_order_line_idx ON commerce.order_edit_lines USING btree (store_id, order_line_id) WHERE (order_line_id IS NOT NULL);


--
-- Name: order_edit_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edit_lines_variant_idx ON commerce.order_edit_lines USING btree (store_id, variant_id);


--
-- Name: order_edits_awaiting_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX order_edits_awaiting_key ON commerce.order_edits USING btree (store_id, order_id) WHERE (status = 'awaiting_payment'::text);


--
-- Name: order_edits_expiry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edits_expiry_idx ON commerce.order_edits USING btree (store_id, status, expires_at) WHERE (status = 'awaiting_payment'::text);


--
-- Name: order_edits_made_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edits_made_by_idx ON commerce.order_edits USING btree (made_by);


--
-- Name: order_edits_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edits_order_idx ON commerce.order_edits USING btree (store_id, order_id);


--
-- Name: order_edits_payment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edits_payment_idx ON commerce.order_edits USING btree (store_id, payment_id);


--
-- Name: order_edits_refund_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_edits_refund_idx ON commerce.order_edits USING btree (store_id, refund_id);


--
-- Name: order_edits_token_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX order_edits_token_key ON commerce.order_edits USING btree (pay_token_hash) WHERE (pay_token_hash IS NOT NULL);


--
-- Name: order_events_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_events_order_idx ON commerce.order_events USING btree (store_id, order_id, created_at);


--
-- Name: order_events_restock_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_events_restock_idx ON commerce.order_events USING btree (store_id, order_id) WHERE (type = ANY (ARRAY['order.refunded'::text, 'order.restocked'::text]));


--
-- Name: order_line_components_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_line_components_line_idx ON commerce.order_line_components USING btree (store_id, order_line_id);


--
-- Name: order_line_components_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_line_components_variant_idx ON commerce.order_line_components USING btree (store_id, variant_id);


--
-- Name: order_lines_analytics_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_lines_analytics_idx ON commerce.order_lines USING btree (store_id, order_id) INCLUDE (quantity, unit_cost_minor, variant_id, delivery);


--
-- Name: order_lines_order_edit_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_lines_order_edit_idx ON commerce.order_lines USING btree (store_id, order_edit_id) WHERE (order_edit_id IS NOT NULL);


--
-- Name: order_lines_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_lines_order_idx ON commerce.order_lines USING btree (store_id, order_id);


--
-- Name: order_lines_search_sku_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_lines_search_sku_idx ON commerce.order_lines USING gin (lower(sku) extensions.gin_trgm_ops);


--
-- Name: order_lines_search_title_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_lines_search_title_idx ON commerce.order_lines USING gin (lower(title) extensions.gin_trgm_ops);


--
-- Name: order_lines_selling_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_lines_selling_plan_idx ON commerce.order_lines USING btree (store_id, selling_plan_id);


--
-- Name: order_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_lines_variant_idx ON commerce.order_lines USING btree (store_id, variant_id);


--
-- Name: order_payment_terms_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_payment_terms_company_idx ON commerce.order_payment_terms USING btree (store_id, company_id) WHERE (paid_at IS NULL);


--
-- Name: order_payment_terms_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_payment_terms_due_idx ON commerce.order_payment_terms USING btree (due_on) WHERE (paid_at IS NULL);


--
-- Name: order_payment_terms_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_payment_terms_order_idx ON commerce.order_payment_terms USING btree (store_id, order_id);


--
-- Name: order_rule_runs_event_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_rule_runs_event_idx ON commerce.order_rule_runs USING btree (event_id);


--
-- Name: order_rule_runs_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_rule_runs_order_idx ON commerce.order_rule_runs USING btree (store_id, order_id);


--
-- Name: order_rule_runs_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_rule_runs_store_idx ON commerce.order_rule_runs USING btree (store_id, created_at DESC NULLS LAST);


--
-- Name: order_rules_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_rules_created_by_idx ON commerce.order_rules USING btree (created_by);


--
-- Name: order_rules_position_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_rules_position_idx ON commerce.order_rules USING btree (store_id, "position");


--
-- Name: order_rules_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_rules_updated_by_idx ON commerce.order_rules USING btree (updated_by);


--
-- Name: order_tags_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_tags_created_by_idx ON commerce.order_tags USING btree (created_by);


--
-- Name: order_tags_key_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_tags_key_idx ON commerce.order_tags USING btree (store_id, key, order_id);


--
-- Name: order_tags_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_tags_order_idx ON commerce.order_tags USING btree (store_id, order_id);


--
-- Name: order_terms_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_terms_store_idx ON commerce.order_terms USING btree (store_id, accepted_at);


--
-- Name: order_views_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_views_created_by_idx ON commerce.order_views USING btree (created_by);


--
-- Name: order_views_position_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX order_views_position_idx ON commerce.order_views USING btree (store_id, "position");


--
-- Name: order_views_title_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX order_views_title_key ON commerce.order_views USING btree (store_id, lower(title));


--
-- Name: orders_approval_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_approval_idx ON commerce.orders USING btree (store_id, approval) WHERE (approval IS NOT NULL);


--
-- Name: orders_authorized_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_authorized_idx ON commerce.orders USING btree (capture_before) WHERE (status = 'authorized'::commerce.order_status);


--
-- Name: orders_cart_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_cart_idx ON commerce.orders USING btree (store_id, cart_id);


--
-- Name: orders_copied_from_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX orders_copied_from_key ON commerce.orders USING btree (store_id, copied_from) WHERE (copied_from IS NOT NULL);


--
-- Name: orders_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_customer_idx ON commerce.orders USING btree (store_id, customer_id);


--
-- Name: orders_delivery_method_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_delivery_method_idx ON commerce.orders USING btree (store_id, delivery_method, status) WHERE (delivery_method <> 'ship'::text);


--
-- Name: orders_discount_code_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_discount_code_idx ON commerce.orders USING btree (store_id, discount_code_id);


--
-- Name: orders_discount_code_item_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_discount_code_item_idx ON commerce.orders USING btree (store_id, discount_code_item_id) WHERE (discount_code_item_id IS NOT NULL);


--
-- Name: orders_draft_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_draft_idx ON commerce.orders USING btree (store_id, draft_id) WHERE (draft_id IS NOT NULL);


--
-- Name: orders_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_email_idx ON commerce.orders USING btree (store_id, lower(email));


--
-- Name: orders_exchange_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_exchange_idx ON commerce.orders USING btree (store_id, exchange_id) WHERE (exchange_id IS NOT NULL);


--
-- Name: orders_exchange_live_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX orders_exchange_live_key ON commerce.orders USING btree (store_id, exchange_id) WHERE ((exchange_id IS NOT NULL) AND (status <> 'cancelled'::commerce.order_status));


--
-- Name: orders_held_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_held_by_idx ON commerce.orders USING btree (held_by);


--
-- Name: orders_held_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_held_idx ON commerce.orders USING btree (store_id, held_at) WHERE (held_at IS NOT NULL);


--
-- Name: orders_host_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_host_idx ON commerce.orders USING btree (store_id, host_id);


--
-- Name: orders_invoice_candidates_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_invoice_candidates_idx ON commerce.orders USING btree (store_id, placed_at) WHERE ((copied_from IS NULL) AND (host_id IS NULL));


--
-- Name: orders_list_archived_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_list_archived_idx ON commerce.orders USING btree (store_id, placed_at DESC, id DESC) WHERE (archived_at IS NOT NULL);


--
-- Name: orders_list_placed_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_list_placed_idx ON commerce.orders USING btree (store_id, placed_at DESC, id DESC) WHERE (archived_at IS NULL);


--
-- Name: orders_list_total_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_list_total_idx ON commerce.orders USING btree (store_id, total_minor, id);


--
-- Name: orders_made_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_made_by_idx ON commerce.orders USING btree (made_by);


--
-- Name: orders_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_market_idx ON commerce.orders USING btree (store_id, market_code, currency);


--
-- Name: orders_number_normalised_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_number_normalised_idx ON commerce.orders USING btree (store_id, upper(regexp_replace(number, '\s'::text, ''::text, 'g'::text)));


--
-- Name: orders_pickup_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_pickup_location_idx ON commerce.orders USING btree (store_id, pickup_location_id) WHERE (pickup_location_id IS NOT NULL);


--
-- Name: orders_retention_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_retention_idx ON commerce.orders USING btree (store_id, placed_at) WHERE (anonymised_at IS NULL);


--
-- Name: orders_search_bill_name_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_search_bill_name_idx ON commerce.orders USING gin (lower((billing_address ->> 'name'::text)) extensions.gin_trgm_ops) WHERE ((restricted_at IS NULL) AND (anonymised_at IS NULL));


--
-- Name: orders_search_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_search_email_idx ON commerce.orders USING gin (lower(email) extensions.gin_trgm_ops) WHERE ((restricted_at IS NULL) AND (anonymised_at IS NULL));


--
-- Name: orders_search_ship_name_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_search_ship_name_idx ON commerce.orders USING gin (lower((shipping_address ->> 'name'::text)) extensions.gin_trgm_ops) WHERE ((restricted_at IS NULL) AND (anonymised_at IS NULL));


--
-- Name: orders_sold_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_sold_idx ON commerce.orders USING btree (store_id, sold_at) WHERE (sold_at IS NOT NULL);


--
-- Name: orders_store_placed_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_store_placed_idx ON commerce.orders USING btree (store_id, placed_at);


--
-- Name: orders_subscription_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_subscription_idx ON commerce.orders USING btree (store_id, subscription_id);


--
-- Name: orders_vat_check_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX orders_vat_check_idx ON commerce.orders USING btree (store_id, vat_check_id);


--
-- Name: own_speed_samples_site_day_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX own_speed_samples_site_day_idx ON commerce.own_speed_samples USING btree (site, day);


--
-- Name: page_ai_jobs_asked_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_ai_jobs_asked_by_idx ON commerce.page_ai_jobs USING btree (asked_by);


--
-- Name: page_ai_jobs_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_ai_jobs_page_idx ON commerce.page_ai_jobs USING btree (page_id);


--
-- Name: page_ai_jobs_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_ai_jobs_store_idx ON commerce.page_ai_jobs USING btree (store_id, created_at);


--
-- Name: page_ai_jobs_waiting_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_ai_jobs_waiting_idx ON commerce.page_ai_jobs USING btree (created_at) WHERE (status = 'waiting'::text);


--
-- Name: page_looks_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_looks_account_idx ON commerce.page_looks USING btree (account_id);


--
-- Name: page_looks_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_looks_page_idx ON commerce.page_looks USING btree (page_id, created_at);


--
-- Name: page_looks_queue_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_looks_queue_idx ON commerce.page_looks USING btree (status, created_at);


--
-- Name: page_looks_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_looks_store_idx ON commerce.page_looks USING btree (store_id, created_at);


--
-- Name: page_redirects_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_redirects_page_idx ON commerce.page_redirects USING btree (page_id);


--
-- Name: page_replications_one_active_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX page_replications_one_active_idx ON commerce.page_replications USING btree (store_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: page_replications_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_replications_page_idx ON commerce.page_replications USING btree (page_id);


--
-- Name: page_replications_requested_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_replications_requested_by_idx ON commerce.page_replications USING btree (requested_by);


--
-- Name: page_replications_store_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_replications_store_created_idx ON commerce.page_replications USING btree (store_id, created_at);


--
-- Name: page_schedules_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_schedules_due_idx ON commerce.page_schedules USING btree (publish_at) WHERE (status = 'waiting'::text);


--
-- Name: page_schedules_one_revert_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX page_schedules_one_revert_idx ON commerce.page_schedules USING btree (page_id) WHERE (revert_status = 'waiting'::text);


--
-- Name: page_schedules_one_waiting_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX page_schedules_one_waiting_idx ON commerce.page_schedules USING btree (page_id) WHERE (status = 'waiting'::text);


--
-- Name: page_schedules_revert_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_schedules_revert_due_idx ON commerce.page_schedules USING btree (revert_at) WHERE (revert_status = 'waiting'::text);


--
-- Name: page_schedules_scheduled_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_schedules_scheduled_by_idx ON commerce.page_schedules USING btree (scheduled_by);


--
-- Name: page_schedules_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_schedules_store_idx ON commerce.page_schedules USING btree (store_id, page_id);


--
-- Name: page_theme_detaches_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_theme_detaches_created_by_idx ON commerce.page_theme_detaches USING btree (created_by);


--
-- Name: page_theme_detaches_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_theme_detaches_page_idx ON commerce.page_theme_detaches USING btree (page_id);


--
-- Name: page_theme_detaches_run_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_theme_detaches_run_idx ON commerce.page_theme_detaches USING btree (run_id);


--
-- Name: page_theme_detaches_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_theme_detaches_store_idx ON commerce.page_theme_detaches USING btree (store_id, created_at);


--
-- Name: page_versions_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_versions_created_by_idx ON commerce.page_versions USING btree (created_by);


--
-- Name: page_versions_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_versions_page_idx ON commerce.page_versions USING btree (page_id, created_at);


--
-- Name: page_versions_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX page_versions_store_idx ON commerce.page_versions USING btree (store_id);


--
-- Name: pages_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX pages_created_by_idx ON commerce.pages USING btree (created_by);


--
-- Name: pages_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX pages_updated_by_idx ON commerce.pages USING btree (updated_by);


--
-- Name: payment_credentials_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payment_credentials_updated_by_idx ON commerce.payment_credentials USING btree (updated_by);


--
-- Name: payment_disputes_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payment_disputes_due_idx ON commerce.payment_disputes USING btree (evidence_due_by) WHERE ((closed_at IS NULL) AND (reminded_at IS NULL));


--
-- Name: payment_disputes_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payment_disputes_order_idx ON commerce.payment_disputes USING btree (store_id, order_id);


--
-- Name: payment_disputes_payment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payment_disputes_payment_idx ON commerce.payment_disputes USING btree (store_id, payment_id);


--
-- Name: payment_methods_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payment_methods_updated_by_idx ON commerce.payment_methods USING btree (updated_by);


--
-- Name: payment_providers_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payment_providers_updated_by_idx ON commerce.payment_providers USING btree (updated_by);


--
-- Name: payments_captured_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_captured_idx ON commerce.payments USING btree (store_id, order_id) INCLUDE (kaizen_fee_minor, currency) WHERE (status = 'captured'::commerce.payment_status);


--
-- Name: payments_charge_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_charge_idx ON commerce.payments USING btree (store_id, charge_reference) WHERE (charge_reference IS NOT NULL);


--
-- Name: payments_exchange_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_exchange_idx ON commerce.payments USING btree (store_id, exchange_id) WHERE (exchange_id IS NOT NULL);


--
-- Name: payments_facts_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_facts_due_idx ON commerce.payments USING btree (created_at) WHERE ((provider = 'stripe'::text) AND (status = 'captured'::commerce.payment_status) AND (facts_read_at IS NULL));


--
-- Name: payments_gift_card_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_gift_card_idx ON commerce.payments USING btree (store_id, gift_card_id) WHERE (gift_card_id IS NOT NULL);


--
-- Name: payments_order_edit_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_order_edit_idx ON commerce.payments USING btree (store_id, order_edit_id) WHERE (order_edit_id IS NOT NULL);


--
-- Name: payments_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_order_idx ON commerce.payments USING btree (store_id, order_id);


--
-- Name: payments_recorded_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payments_recorded_by_idx ON commerce.payments USING btree (recorded_by);


--
-- Name: payments_transfer_refund_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX payments_transfer_refund_key ON commerce.payments USING btree (store_id, transfer_refund_id) WHERE (transfer_refund_id IS NOT NULL);


--
-- Name: payout_lines_dispute_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payout_lines_dispute_idx ON commerce.payout_lines USING btree (store_id, dispute_id) WHERE (dispute_id IS NOT NULL);


--
-- Name: payout_lines_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payout_lines_order_idx ON commerce.payout_lines USING btree (store_id, order_id) WHERE (order_id IS NOT NULL);


--
-- Name: payout_lines_payment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payout_lines_payment_idx ON commerce.payout_lines USING btree (store_id, payment_id) WHERE (payment_id IS NOT NULL);


--
-- Name: payout_lines_payout_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payout_lines_payout_idx ON commerce.payout_lines USING btree (store_id, payout_id);


--
-- Name: payout_lines_refund_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payout_lines_refund_idx ON commerce.payout_lines USING btree (store_id, refund_id) WHERE (refund_id IS NOT NULL);


--
-- Name: payouts_arrival_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payouts_arrival_idx ON commerce.payouts USING btree (store_id, arrival_on);


--
-- Name: payouts_lines_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX payouts_lines_due_idx ON commerce.payouts USING btree (provider_created_at) WHERE ((lines_read_at IS NULL) AND (status = 'paid'::text) AND automatic);


--
-- Name: pickup_options_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX pickup_options_market_idx ON commerce.pickup_options USING btree (store_id, market_code, currency);


--
-- Name: plan_feature_grants_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_feature_grants_plan_idx ON commerce.plan_feature_grants USING btree (plan_id);


--
-- Name: plan_features_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_features_updated_by_idx ON commerce.plan_features USING btree (updated_by);


--
-- Name: plan_limits_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_limits_updated_by_idx ON commerce.plan_limits USING btree (updated_by);


--
-- Name: plan_moves_at_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_moves_at_idx ON commerce.plan_moves USING btree (at);


--
-- Name: plan_moves_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_moves_plan_idx ON commerce.plan_moves USING btree (plan_id);


--
-- Name: plan_moves_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_moves_store_idx ON commerce.plan_moves USING btree (store_id, at);


--
-- Name: plan_prices_one_active; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX plan_prices_one_active ON commerce.plan_prices USING btree (plan_id, currency, "interval") WHERE active;


--
-- Name: plan_prices_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_prices_plan_idx ON commerce.plan_prices USING btree (plan_id);


--
-- Name: plan_reminder_steps_delay_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plan_reminder_steps_delay_idx ON commerce.plan_reminder_steps USING btree (delay_minutes);


--
-- Name: plans_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX plans_updated_by_idx ON commerce.plans USING btree (updated_by);


--
-- Name: platform_ad_conversions_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_ad_conversions_created_idx ON commerce.platform_ad_conversions USING btree (created_at);


--
-- Name: platform_ad_conversions_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_ad_conversions_due_idx ON commerce.platform_ad_conversions USING btree (status, next_at);


--
-- Name: platform_api_tokens_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_api_tokens_created_by_idx ON commerce.platform_api_tokens USING btree (created_by);


--
-- Name: platform_discount_codes_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_discount_codes_created_by_idx ON commerce.platform_discount_codes USING btree (created_by);


--
-- Name: platform_integration_deliveries_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_integration_deliveries_due_idx ON commerce.platform_integration_deliveries USING btree (next_attempt_at) WHERE (status = 'pending'::text);


--
-- Name: platform_integration_deliveries_endpoint_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_integration_deliveries_endpoint_idx ON commerce.platform_integration_deliveries USING btree (endpoint_id, created_at);


--
-- Name: platform_integration_deliveries_provider_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_integration_deliveries_provider_idx ON commerce.platform_integration_deliveries USING btree (provider, created_at);


--
-- Name: platform_integration_deliveries_subject_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_integration_deliveries_subject_idx ON commerce.platform_integration_deliveries USING btree (subject_id);


--
-- Name: platform_integrations_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_integrations_updated_by_idx ON commerce.platform_integrations USING btree (updated_by);


--
-- Name: platform_marketing_spend_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_marketing_spend_created_by_idx ON commerce.platform_marketing_spend USING btree (created_by);


--
-- Name: platform_page_roles_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_page_roles_updated_by_idx ON commerce.platform_page_roles USING btree (updated_by);


--
-- Name: platform_payout_lines_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX platform_payout_lines_key ON commerce.platform_payout_lines USING btree (payout_id, stripe_balance_transaction_id);


--
-- Name: platform_payout_lines_sale_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_payout_lines_sale_idx ON commerce.platform_payout_lines USING btree (sale_id);


--
-- Name: platform_payouts_arrival_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_payouts_arrival_idx ON commerce.platform_payouts USING btree (mode, arrival_on);


--
-- Name: platform_payouts_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX platform_payouts_key ON commerce.platform_payouts USING btree (mode, stripe_payout_id);


--
-- Name: platform_sales_buyer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_sales_buyer_idx ON commerce.platform_sales USING btree (buyer_store_id);


--
-- Name: platform_sales_invoice_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX platform_sales_invoice_key ON commerce.platform_sales USING btree (mode, stripe_invoice_id);


--
-- Name: platform_sales_paid_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_sales_paid_idx ON commerce.platform_sales USING btree (mode, paid_at);


--
-- Name: platform_settings_footer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_settings_footer_idx ON commerce.platform_settings USING btree (footer_id);


--
-- Name: platform_settings_footer_menu_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_settings_footer_menu_idx ON commerce.platform_settings USING btree (footer_menu_id);


--
-- Name: platform_settings_header_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_settings_header_idx ON commerce.platform_settings USING btree (header_id);


--
-- Name: platform_settings_header_menu_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_settings_header_menu_idx ON commerce.platform_settings USING btree (header_menu_id);


--
-- Name: platform_settings_sandbox_source_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_settings_sandbox_source_idx ON commerce.platform_settings USING btree (sandbox_source);


--
-- Name: platform_settings_site_from_store_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_settings_site_from_store_by_idx ON commerce.platform_settings USING btree (site_from_store_by);


--
-- Name: platform_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_settings_updated_by_idx ON commerce.platform_settings USING btree (updated_by);


--
-- Name: platform_targets_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_targets_created_by_idx ON commerce.platform_targets USING btree (created_by);


--
-- Name: platform_targets_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX platform_targets_key ON commerce.platform_targets USING btree (metric, month, COALESCE(currency, ''::bpchar));


--
-- Name: platform_theme_install_updates_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_install_updates_by_idx ON commerce.platform_theme_install_updates USING btree (updated_by);


--
-- Name: platform_theme_install_updates_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_install_updates_created_idx ON commerce.platform_theme_install_updates USING btree (created_at);


--
-- Name: platform_theme_install_updates_from_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_install_updates_from_idx ON commerce.platform_theme_install_updates USING btree (from_version_id);


--
-- Name: platform_theme_install_updates_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_install_updates_install_idx ON commerce.platform_theme_install_updates USING btree (install_id);


--
-- Name: platform_theme_install_updates_to_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_install_updates_to_idx ON commerce.platform_theme_install_updates USING btree (to_version_id);


--
-- Name: platform_theme_installs_installed_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_installs_installed_by_idx ON commerce.platform_theme_installs USING btree (installed_by);


--
-- Name: platform_theme_installs_live_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX platform_theme_installs_live_idx ON commerce.platform_theme_installs USING btree (live) WHERE live;


--
-- Name: platform_theme_installs_preset_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_installs_preset_idx ON commerce.platform_theme_installs USING btree (preset_id);


--
-- Name: platform_theme_installs_version_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_theme_installs_version_idx ON commerce.platform_theme_installs USING btree (version_id);


--
-- Name: platform_webhook_endpoints_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_webhook_endpoints_created_by_idx ON commerce.platform_webhook_endpoints USING btree (created_by);


--
-- Name: platform_webhooks_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_webhooks_updated_by_idx ON commerce.platform_webhooks USING btree (updated_by);


--
-- Name: platform_workflow_runs_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_workflow_runs_due_idx ON commerce.platform_workflow_runs USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: platform_workflow_runs_workflow_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_workflow_runs_workflow_idx ON commerce.platform_workflow_runs USING btree (workflow_id, created_at);


--
-- Name: platform_workflows_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_workflows_created_by_idx ON commerce.platform_workflows USING btree (created_by);


--
-- Name: platform_workflows_trigger_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_workflows_trigger_idx ON commerce.platform_workflows USING btree (trigger) WHERE enabled;


--
-- Name: platform_workflows_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX platform_workflows_updated_by_idx ON commerce.platform_workflows USING btree (updated_by);


--
-- Name: preview_links_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX preview_links_created_by_idx ON commerce.preview_links USING btree (created_by);


--
-- Name: preview_links_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX preview_links_install_idx ON commerce.preview_links USING btree (install_id);


--
-- Name: preview_links_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX preview_links_page_idx ON commerce.preview_links USING btree (store_id, page_id);


--
-- Name: preview_links_revoked_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX preview_links_revoked_by_idx ON commerce.preview_links USING btree (revoked_by);


--
-- Name: preview_links_token_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX preview_links_token_idx ON commerce.preview_links USING btree (token_hash);


--
-- Name: price_breaks_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_breaks_product_idx ON commerce.price_breaks USING btree (store_id, product_id);


--
-- Name: price_breaks_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_breaks_variant_idx ON commerce.price_breaks USING btree (store_id, variant_id);


--
-- Name: price_list_assignments_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX price_list_assignments_company_idx ON commerce.price_list_assignments USING btree (list_id, company_id) WHERE (company_id IS NOT NULL);


--
-- Name: price_list_assignments_list_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_assignments_list_fk_idx ON commerce.price_list_assignments USING btree (store_id, list_id);


--
-- Name: price_list_assignments_store_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_assignments_store_company_idx ON commerce.price_list_assignments USING btree (store_id, company_id);


--
-- Name: price_list_assignments_store_tier_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_assignments_store_tier_idx ON commerce.price_list_assignments USING btree (store_id, tier_id);


--
-- Name: price_list_assignments_tier_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX price_list_assignments_tier_idx ON commerce.price_list_assignments USING btree (list_id, tier_id) WHERE (tier_id IS NOT NULL);


--
-- Name: price_list_breaks_list_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_breaks_list_fk_idx ON commerce.price_list_breaks USING btree (store_id, list_id);


--
-- Name: price_list_breaks_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_breaks_variant_idx ON commerce.price_list_breaks USING btree (store_id, variant_id);


--
-- Name: price_list_prices_list_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_prices_list_fk_idx ON commerce.price_list_prices USING btree (store_id, list_id);


--
-- Name: price_list_prices_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_prices_variant_idx ON commerce.price_list_prices USING btree (store_id, variant_id);


--
-- Name: price_list_products_list_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_products_list_fk_idx ON commerce.price_list_products USING btree (store_id, list_id);


--
-- Name: price_list_products_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX price_list_products_product_idx ON commerce.price_list_products USING btree (list_id, product_id) WHERE (product_id IS NOT NULL);


--
-- Name: price_list_products_store_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_products_store_product_idx ON commerce.price_list_products USING btree (store_id, product_id);


--
-- Name: price_list_products_term_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_products_term_fk_idx ON commerce.price_list_products USING btree (term_id);


--
-- Name: price_list_products_term_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX price_list_products_term_idx ON commerce.price_list_products USING btree (list_id, term_id) WHERE (term_id IS NOT NULL);


--
-- Name: price_list_quantity_rules_list_fk_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_quantity_rules_list_fk_idx ON commerce.price_list_quantity_rules USING btree (store_id, list_id);


--
-- Name: price_list_quantity_rules_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_list_quantity_rules_variant_idx ON commerce.price_list_quantity_rules USING btree (store_id, variant_id);


--
-- Name: price_lists_exclusive_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX price_lists_exclusive_idx ON commerce.price_lists USING btree (store_id) WHERE (exclusive AND active);


--
-- Name: price_lists_name_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX price_lists_name_idx ON commerce.price_lists USING btree (store_id, lower(name));


--
-- Name: prices_history_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX prices_history_idx ON commerce.prices USING btree (variant_id, market_code, valid_from);


--
-- Name: prices_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX prices_market_idx ON commerce.prices USING btree (store_id, market_code, currency);


--
-- Name: prices_one_current_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX prices_one_current_idx ON commerce.prices USING btree (variant_id, market_code) WHERE (valid_to IS NULL);


--
-- Name: prices_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX prices_variant_idx ON commerce.prices USING btree (store_id, variant_id);


--
-- Name: privacy_requests_handled_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX privacy_requests_handled_by_idx ON commerce.privacy_requests USING btree (handled_by);


--
-- Name: privacy_requests_open_erasure_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX privacy_requests_open_erasure_key ON commerce.privacy_requests USING btree (store_id, subject_email) WHERE ((status = 'open'::text) AND (kind = 'erasure'::text));


--
-- Name: privacy_requests_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX privacy_requests_status_idx ON commerce.privacy_requests USING btree (store_id, status, due_at);


--
-- Name: producer_registrations_market_scheme_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX producer_registrations_market_scheme_idx ON commerce.producer_registrations USING btree (store_id, market_code, scheme);


--
-- Name: product_embeddings_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_embeddings_product_idx ON commerce.product_embeddings USING btree (store_id, product_id);


--
-- Name: product_embeddings_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_embeddings_store_idx ON commerce.product_embeddings USING btree (store_id, space);


--
-- Name: product_files_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_files_product_idx ON commerce.product_files USING btree (store_id, product_id, "position");


--
-- Name: product_files_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_files_variant_idx ON commerce.product_files USING btree (store_id, variant_id);


--
-- Name: product_market_texts_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_market_texts_market_idx ON commerce.product_market_texts USING btree (store_id, market_code);


--
-- Name: product_market_texts_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_market_texts_product_idx ON commerce.product_market_texts USING btree (store_id, product_id);


--
-- Name: product_media_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_media_product_idx ON commerce.product_media USING btree (store_id, product_id, "position");


--
-- Name: product_passports_id_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX product_passports_id_key ON commerce.product_passports USING btree (id);


--
-- Name: product_passports_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_passports_updated_by_idx ON commerce.product_passports USING btree (updated_by);


--
-- Name: product_resources_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_resources_product_idx ON commerce.product_resources USING btree (store_id, product_id);


--
-- Name: product_resources_resource_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_resources_resource_idx ON commerce.product_resources USING btree (store_id, resource_id);


--
-- Name: product_reviews_answered_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_reviews_answered_by_idx ON commerce.product_reviews USING btree (answered_by);


--
-- Name: product_reviews_buyer_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX product_reviews_buyer_key ON commerce.product_reviews USING btree (store_id, product_id, buyer_key) WHERE (source = 'buyer'::text);


--
-- Name: product_reviews_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_reviews_customer_idx ON commerce.product_reviews USING btree (store_id, customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: product_reviews_line_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX product_reviews_line_key ON commerce.product_reviews USING btree (store_id, order_line_id) WHERE (order_line_id IS NOT NULL);


--
-- Name: product_reviews_moderated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_reviews_moderated_by_idx ON commerce.product_reviews USING btree (moderated_by);


--
-- Name: product_reviews_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_reviews_order_idx ON commerce.product_reviews USING btree (store_id, order_id) WHERE (order_id IS NOT NULL);


--
-- Name: product_reviews_queue_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_reviews_queue_idx ON commerce.product_reviews USING btree (store_id, status, created_at);


--
-- Name: product_reviews_shown_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_reviews_shown_idx ON commerce.product_reviews USING btree (store_id, product_id, created_at) WHERE (status = 'published'::text);


--
-- Name: product_reviews_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_reviews_variant_idx ON commerce.product_reviews USING btree (store_id, variant_id) WHERE (variant_id IS NOT NULL);


--
-- Name: product_schemes_store_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_schemes_store_product_idx ON commerce.product_schemes USING btree (store_id, product_id);


--
-- Name: product_terms_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_terms_product_idx ON commerce.product_terms USING btree (store_id, product_id);


--
-- Name: product_terms_term_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_terms_term_idx ON commerce.product_terms USING btree (store_id, content_type, term_id);


--
-- Name: product_translations_search_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_translations_search_idx ON commerce.product_translations USING gin (search);


--
-- Name: product_translations_store_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_translations_store_product_idx ON commerce.product_translations USING btree (store_id, product_id);


--
-- Name: product_translations_title_trgm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_translations_title_trgm_idx ON commerce.product_translations USING gin (lower(title) extensions.gin_trgm_ops);


--
-- Name: product_variants_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_variants_product_idx ON commerce.product_variants USING btree (store_id, product_id);


--
-- Name: product_variants_sku_trgm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_variants_sku_trgm_idx ON commerce.product_variants USING gin (lower(sku) extensions.gin_trgm_ops);


--
-- Name: product_variants_supplier_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX product_variants_supplier_idx ON commerce.product_variants USING btree (store_id, supplier_id) WHERE (supplier_id IS NOT NULL);


--
-- Name: products_group_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_group_idx ON commerce.products USING btree (store_id, group_id);


--
-- Name: products_host_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_host_idx ON commerce.products USING btree (store_id, host_id);


--
-- Name: products_manufacturer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_manufacturer_idx ON commerce.products USING btree (store_id, manufacturer_id);


--
-- Name: products_product_layout_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_product_layout_idx ON commerce.products USING btree (store_id, product_layout_id);


--
-- Name: products_responsible_person_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_responsible_person_idx ON commerce.products USING btree (store_id, responsible_person_id);


--
-- Name: products_shipping_profile_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_shipping_profile_idx ON commerce.products USING btree (store_id, shipping_profile_id);


--
-- Name: products_standard_attributes_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_standard_attributes_idx ON commerce.products USING gin (standard_attributes jsonb_path_ops);


--
-- Name: products_standard_category_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_standard_category_idx ON commerce.products USING btree (store_id, standard_category);


--
-- Name: products_store_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_store_status_idx ON commerce.products USING btree (store_id, status);


--
-- Name: products_vat_category_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX products_vat_category_idx ON commerce.products USING btree (vat_category);


--
-- Name: purchase_order_lines_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX purchase_order_lines_order_idx ON commerce.purchase_order_lines USING btree (store_id, purchase_order_id);


--
-- Name: purchase_order_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX purchase_order_lines_variant_idx ON commerce.purchase_order_lines USING btree (store_id, variant_id);


--
-- Name: purchase_orders_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX purchase_orders_created_by_idx ON commerce.purchase_orders USING btree (created_by);


--
-- Name: purchase_orders_location_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX purchase_orders_location_idx ON commerce.purchase_orders USING btree (store_id, location_id);


--
-- Name: purchase_orders_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX purchase_orders_store_idx ON commerce.purchase_orders USING btree (store_id, created_at DESC NULLS LAST);


--
-- Name: push_subscriptions_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX push_subscriptions_account_idx ON commerce.push_subscriptions USING btree (account_id, store_id);


--
-- Name: push_subscriptions_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX push_subscriptions_store_idx ON commerce.push_subscriptions USING btree (store_id);


--
-- Name: recommendation_adds_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recommendation_adds_created_idx ON commerce.recommendation_adds USING btree (created_at);


--
-- Name: recommendation_adds_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recommendation_adds_store_idx ON commerce.recommendation_adds USING btree (store_id, created_at);


--
-- Name: recommendation_events_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recommendation_events_created_idx ON commerce.recommendation_events USING btree (created_at);


--
-- Name: recommendation_events_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recommendation_events_store_idx ON commerce.recommendation_events USING btree (store_id, created_at);


--
-- Name: recommendation_rules_hide_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX recommendation_rules_hide_key ON commerce.recommendation_rules USING btree (store_id, product_id) WHERE (kind = 'hide'::text);


--
-- Name: recommendation_rules_pair_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX recommendation_rules_pair_key ON commerce.recommendation_rules USING btree (store_id, kind, product_id, other_product_id) WHERE (other_product_id IS NOT NULL);


--
-- Name: recommendation_rules_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recommendation_rules_product_idx ON commerce.recommendation_rules USING btree (store_id, product_id);


--
-- Name: recommendation_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recommendation_settings_updated_by_idx ON commerce.recommendation_settings USING btree (updated_by);


--
-- Name: recurring_costs_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recurring_costs_created_by_idx ON commerce.recurring_costs USING btree (created_by);


--
-- Name: recurring_costs_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX recurring_costs_store_idx ON commerce.recurring_costs USING btree (store_id);


--
-- Name: redirects_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX redirects_created_by_idx ON commerce.redirects USING btree (created_by);


--
-- Name: redirects_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX redirects_entry_idx ON commerce.redirects USING btree (entry_id);


--
-- Name: redirects_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX redirects_product_idx ON commerce.redirects USING btree (store_id, product_id);


--
-- Name: redirects_source_trgm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX redirects_source_trgm_idx ON commerce.redirects USING gin (lower(source) extensions.gin_trgm_ops);


--
-- Name: redirects_store_kind_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX redirects_store_kind_idx ON commerce.redirects USING btree (store_id, kind);


--
-- Name: redirects_target_trgm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX redirects_target_trgm_idx ON commerce.redirects USING gin (lower(target) extensions.gin_trgm_ops);


--
-- Name: redirects_term_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX redirects_term_idx ON commerce.redirects USING btree (term_id);


--
-- Name: referral_allocations_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_allocations_entry_idx ON commerce.referral_allocations USING btree (entry_id);


--
-- Name: referral_entries_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_entries_account_idx ON commerce.referral_entries USING btree (account_id, currency, created_at);


--
-- Name: referral_entries_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_entries_created_by_idx ON commerce.referral_entries USING btree (created_by);


--
-- Name: referral_entries_invoice_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_entries_invoice_idx ON commerce.referral_entries USING btree (invoice_ref);


--
-- Name: referral_entries_referral_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_entries_referral_idx ON commerce.referral_entries USING btree (referral_id);


--
-- Name: referral_entries_source_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_entries_source_idx ON commerce.referral_entries USING btree (source_kind, source_ref);


--
-- Name: referral_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_settings_updated_by_idx ON commerce.referral_settings USING btree (updated_by);


--
-- Name: referral_visits_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX referral_visits_key ON commerce.referral_visits USING btree (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), code, day);


--
-- Name: referral_visits_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referral_visits_store_idx ON commerce.referral_visits USING btree (store_id);


--
-- Name: referrals_access_request_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referrals_access_request_idx ON commerce.referrals USING btree (access_request_id);


--
-- Name: referrals_referrer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX referrals_referrer_idx ON commerce.referrals USING btree (referrer_account_id, created_at);


--
-- Name: refunds_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX refunds_created_by_idx ON commerce.refunds USING btree (created_by);


--
-- Name: refunds_exchange_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX refunds_exchange_idx ON commerce.refunds USING btree (store_id, exchange_id) WHERE (exchange_id IS NOT NULL);


--
-- Name: refunds_order_edit_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX refunds_order_edit_idx ON commerce.refunds USING btree (store_id, order_edit_id) WHERE (order_edit_id IS NOT NULL);


--
-- Name: refunds_payment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX refunds_payment_idx ON commerce.refunds USING btree (store_id, payment_id);


--
-- Name: refunds_store_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX refunds_store_created_idx ON commerce.refunds USING btree (store_id, created_at);


--
-- Name: report_schedules_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX report_schedules_created_by_idx ON commerce.report_schedules USING btree (created_by);


--
-- Name: report_schedules_report_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX report_schedules_report_idx ON commerce.report_schedules USING btree (report_id);


--
-- Name: report_schedules_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX report_schedules_store_idx ON commerce.report_schedules USING btree (store_id);


--
-- Name: report_schedules_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX report_schedules_updated_by_idx ON commerce.report_schedules USING btree (updated_by);


--
-- Name: research_notes_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX research_notes_account_idx ON commerce.research_notes USING btree (account_id);


--
-- Name: research_notes_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX research_notes_store_idx ON commerce.research_notes USING btree (store_id, created_at);


--
-- Name: research_sources_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX research_sources_account_idx ON commerce.research_sources USING btree (account_id);


--
-- Name: research_sources_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX research_sources_store_idx ON commerce.research_sources USING btree (store_id, created_at);


--
-- Name: research_sources_url_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX research_sources_url_idx ON commerce.research_sources USING btree (store_id, url);


--
-- Name: resource_blocks_feed_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX resource_blocks_feed_idx ON commerce.resource_blocks USING btree (store_id, feed_id);


--
-- Name: resource_blocks_feed_uid_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX resource_blocks_feed_uid_key ON commerce.resource_blocks USING btree (feed_id, uid);


--
-- Name: resource_blocks_resource_time_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX resource_blocks_resource_time_idx ON commerce.resource_blocks USING btree (store_id, resource_id, starts_at);


--
-- Name: retention_rules_country_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX retention_rules_country_idx ON commerce.retention_rules USING btree (country);


--
-- Name: retention_rules_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX retention_rules_created_by_idx ON commerce.retention_rules USING btree (created_by);


--
-- Name: retention_rules_current_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX retention_rules_current_key ON commerce.retention_rules USING btree (kind, COALESCE(country, '__'::bpchar)) WHERE (valid_to IS NULL);


--
-- Name: retention_rules_period_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX retention_rules_period_key ON commerce.retention_rules USING btree (kind, COALESCE(country, '__'::bpchar), valid_from);


--
-- Name: retention_rules_verified_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX retention_rules_verified_by_idx ON commerce.retention_rules USING btree (verified_by);


--
-- Name: return_exchange_lines_exchange_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchange_lines_exchange_idx ON commerce.return_exchange_lines USING btree (store_id, exchange_id);


--
-- Name: return_exchange_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchange_lines_variant_idx ON commerce.return_exchange_lines USING btree (store_id, variant_id);


--
-- Name: return_exchanges_exchange_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchanges_exchange_order_idx ON commerce.return_exchanges USING btree (store_id, exchange_order_id);


--
-- Name: return_exchanges_expiry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchanges_expiry_idx ON commerce.return_exchanges USING btree (store_id, status, expires_at) WHERE (status = ANY (ARRAY['proposed'::text, 'confirmed'::text, 'processed'::text]));


--
-- Name: return_exchanges_made_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchanges_made_by_idx ON commerce.return_exchanges USING btree (made_by);


--
-- Name: return_exchanges_open_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX return_exchanges_open_key ON commerce.return_exchanges USING btree (store_id, return_id) WHERE (status = ANY (ARRAY['draft'::text, 'proposed'::text, 'confirmed'::text, 'processed'::text]));


--
-- Name: return_exchanges_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchanges_order_idx ON commerce.return_exchanges USING btree (store_id, order_id);


--
-- Name: return_exchanges_refund_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchanges_refund_idx ON commerce.return_exchanges USING btree (store_id, refund_id);


--
-- Name: return_exchanges_return_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchanges_return_idx ON commerce.return_exchanges USING btree (store_id, return_id);


--
-- Name: return_exchanges_token_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX return_exchanges_token_key ON commerce.return_exchanges USING btree (token_hash) WHERE (token_hash IS NOT NULL);


--
-- Name: return_exchanges_transfer_refund_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_exchanges_transfer_refund_idx ON commerce.return_exchanges USING btree (store_id, transfer_refund_id);


--
-- Name: return_lines_order_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_lines_order_line_idx ON commerce.return_lines USING btree (store_id, order_line_id);


--
-- Name: return_lines_return_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_lines_return_idx ON commerce.return_lines USING btree (store_id, return_id);


--
-- Name: return_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX return_settings_updated_by_idx ON commerce.return_settings USING btree (updated_by);


--
-- Name: returns_label_pending_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX returns_label_pending_idx ON commerce.returns USING btree (store_id, created_at) WHERE ((kind = 'withdrawal'::text) AND (label_source IS NULL));


--
-- Name: returns_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX returns_order_idx ON commerce.returns USING btree (store_id, order_id);


--
-- Name: returns_queue_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX returns_queue_idx ON commerce.returns USING btree (store_id, status, created_at);


--
-- Name: returns_refund_deadline_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX returns_refund_deadline_idx ON commerce.returns USING btree (store_id, refund_deadline);


--
-- Name: returns_refund_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX returns_refund_idx ON commerce.returns USING btree (store_id, refund_id);


--
-- Name: returns_refund_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX returns_refund_key ON commerce.returns USING btree (store_id, refund_id) WHERE (refund_id IS NOT NULL);


--
-- Name: returns_withdrawal_request_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX returns_withdrawal_request_idx ON commerce.returns USING btree (store_id, withdrawal_request_id);


--
-- Name: returns_withdrawal_request_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX returns_withdrawal_request_key ON commerce.returns USING btree (store_id, withdrawal_request_id) WHERE (withdrawal_request_id IS NOT NULL);


--
-- Name: review_pictures_hidden_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX review_pictures_hidden_by_idx ON commerce.review_pictures USING btree (hidden_by);


--
-- Name: review_requests_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX review_requests_created_idx ON commerce.review_requests USING btree (store_id, created_at);


--
-- Name: sandboxes_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sandboxes_created_idx ON commerce.sandboxes USING btree (created_at);


--
-- Name: sandboxes_expired_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sandboxes_expired_idx ON commerce.sandboxes USING btree (ended_at) WHERE (state = 'expired'::text);


--
-- Name: sandboxes_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sandboxes_open_idx ON commerce.sandboxes USING btree (expires_at) WHERE (state = 'open'::text);


--
-- Name: sandboxes_source_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sandboxes_source_idx ON commerce.sandboxes USING btree (source_store_id);


--
-- Name: saved_parts_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_parts_created_by_idx ON commerce.saved_parts USING btree (created_by);


--
-- Name: saved_parts_hidden_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_parts_hidden_by_idx ON commerce.saved_parts USING btree (hidden_by);


--
-- Name: saved_parts_shared_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_parts_shared_idx ON commerce.saved_parts USING btree (sharing, updated_at) WHERE (sharing <> 'private'::text);


--
-- Name: saved_parts_store_kind_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_parts_store_kind_idx ON commerce.saved_parts USING btree (store_id, kind, name);


--
-- Name: saved_parts_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_parts_updated_by_idx ON commerce.saved_parts USING btree (updated_by);


--
-- Name: saved_reports_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_reports_created_by_idx ON commerce.saved_reports USING btree (created_by);


--
-- Name: saved_reports_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_reports_store_idx ON commerce.saved_reports USING btree (store_id, title);


--
-- Name: saved_reports_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX saved_reports_updated_by_idx ON commerce.saved_reports USING btree (updated_by);


--
-- Name: search_cache_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_cache_created_idx ON commerce.search_cache USING btree (created_at);


--
-- Name: search_clicks_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_clicks_product_idx ON commerce.search_clicks USING btree (store_id, product_id);


--
-- Name: search_clicks_search_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_clicks_search_idx ON commerce.search_clicks USING btree (search_id);


--
-- Name: search_experiments_ended_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_experiments_ended_by_idx ON commerce.search_experiments USING btree (ended_by);


--
-- Name: search_experiments_one_running; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX search_experiments_one_running ON commerce.search_experiments USING btree ((true)) WHERE (ended_at IS NULL);


--
-- Name: search_experiments_started_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_experiments_started_by_idx ON commerce.search_experiments USING btree (started_by);


--
-- Name: search_queries_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_queries_created_idx ON commerce.search_queries USING btree (created_at);


--
-- Name: search_queries_experiment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_queries_experiment_idx ON commerce.search_queries USING btree (experiment_id, arm);


--
-- Name: search_queries_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_queries_store_idx ON commerce.search_queries USING btree (store_id, created_at);


--
-- Name: search_queries_visit_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_queries_visit_idx ON commerce.search_queries USING btree (visit_id);


--
-- Name: search_rules_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_rules_product_idx ON commerce.search_rules USING btree (store_id, product_id);


--
-- Name: search_rules_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_rules_store_idx ON commerce.search_rules USING btree (store_id, "position");


--
-- Name: search_rules_term_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_rules_term_idx ON commerce.search_rules USING btree (store_id, content_type, term_id);


--
-- Name: search_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_settings_updated_by_idx ON commerce.search_settings USING btree (updated_by);


--
-- Name: search_synonyms_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX search_synonyms_store_idx ON commerce.search_synonyms USING btree (store_id, locale);


--
-- Name: segments_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX segments_created_by_idx ON commerce.segments USING btree (created_by);


--
-- Name: segments_title_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX segments_title_idx ON commerce.segments USING btree (store_id, lower(title));


--
-- Name: selling_plans_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX selling_plans_product_idx ON commerce.selling_plans USING btree (store_id, product_id, "position");


--
-- Name: shipment_lines_order_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipment_lines_order_line_idx ON commerce.shipment_lines USING btree (store_id, order_line_id);


--
-- Name: shipment_lines_shipment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipment_lines_shipment_idx ON commerce.shipment_lines USING btree (store_id, shipment_id);


--
-- Name: shipment_tracking_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipment_tracking_due_idx ON commerce.shipment_tracking USING btree (next_check_at) WHERE (stopped IS NULL);


--
-- Name: shipment_tracking_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipment_tracking_order_idx ON commerce.shipment_tracking USING btree (store_id, order_id);


--
-- Name: shipments_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipments_created_by_idx ON commerce.shipments USING btree (created_by);


--
-- Name: shipments_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipments_order_idx ON commerce.shipments USING btree (store_id, order_id);


--
-- Name: shipments_tracking_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipments_tracking_idx ON commerce.shipments USING btree (store_id, lower(tracking_number));


--
-- Name: shipments_undone_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipments_undone_by_idx ON commerce.shipments USING btree (undone_by);


--
-- Name: shipping_carriers_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_carriers_updated_by_idx ON commerce.shipping_carriers USING btree (updated_by);


--
-- Name: shipping_method_rates_group_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_method_rates_group_idx ON commerce.shipping_method_rates USING btree (store_id, method_id, zone_id, profile_id);


--
-- Name: shipping_method_rates_profile_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_method_rates_profile_idx ON commerce.shipping_method_rates USING btree (store_id, profile_id);


--
-- Name: shipping_method_rates_zone_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_method_rates_zone_idx ON commerce.shipping_method_rates USING btree (store_id, zone_id);


--
-- Name: shipping_methods_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_methods_market_idx ON commerce.shipping_methods USING btree (store_id, market_code, currency, "position");


--
-- Name: shipping_profiles_name_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX shipping_profiles_name_key ON commerce.shipping_profiles USING btree (store_id, lower(name));


--
-- Name: shipping_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_settings_updated_by_idx ON commerce.shipping_settings USING btree (updated_by);


--
-- Name: shipping_vat_rules_verified_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_vat_rules_verified_by_idx ON commerce.shipping_vat_rules USING btree (verified_by);


--
-- Name: shipping_zones_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shipping_zones_market_idx ON commerce.shipping_zones USING btree (store_id, market_code, "position");


--
-- Name: shop_moves_connected_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shop_moves_connected_by_idx ON commerce.shop_moves USING btree (connected_by);


--
-- Name: shop_moves_shop_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX shop_moves_shop_idx ON commerce.shop_moves USING btree (source, shop_domain);


--
-- Name: signup_incentives_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX signup_incentives_email_idx ON commerce.signup_incentives USING btree (store_id, email);


--
-- Name: signup_incentives_item_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX signup_incentives_item_idx ON commerce.signup_incentives USING btree (store_id, code_item_id);


--
-- Name: site_staging_pages_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX site_staging_pages_page_idx ON commerce.site_staging_pages USING btree (page_id);


--
-- Name: site_staging_pages_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX site_staging_pages_store_idx ON commerce.site_staging_pages USING btree (store_id);


--
-- Name: site_stagings_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX site_stagings_created_by_idx ON commerce.site_stagings USING btree (created_by);


--
-- Name: site_stagings_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX site_stagings_install_idx ON commerce.site_stagings USING btree (install_id);


--
-- Name: site_stagings_one_open; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX site_stagings_one_open ON commerce.site_stagings USING btree (store_id) WHERE (status = 'open'::text);


--
-- Name: site_stagings_published_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX site_stagings_published_by_idx ON commerce.site_stagings USING btree (published_by);


--
-- Name: sms_campaigns_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_campaigns_created_by_idx ON commerce.sms_campaigns USING btree (created_by);


--
-- Name: sms_campaigns_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_campaigns_list_idx ON commerce.sms_campaigns USING btree (store_id, created_at);


--
-- Name: sms_campaigns_segment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_campaigns_segment_idx ON commerce.sms_campaigns USING btree (store_id, segment_id);


--
-- Name: sms_campaigns_sending_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_campaigns_sending_idx ON commerce.sms_campaigns USING btree (status) WHERE (status = 'sending'::text);


--
-- Name: sms_consent_events_subscriber_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_consent_events_subscriber_idx ON commerce.sms_consent_events USING btree (store_id, subscriber_id, created_at);


--
-- Name: sms_messages_campaign_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_messages_campaign_idx ON commerce.sms_messages USING btree (store_id, campaign_id);


--
-- Name: sms_messages_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_messages_due_idx ON commerce.sms_messages USING btree (send_after) WHERE (status = 'queued'::text);


--
-- Name: sms_messages_month_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_messages_month_idx ON commerce.sms_messages USING btree (store_id, sent_at);


--
-- Name: sms_messages_once_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX sms_messages_once_idx ON commerce.sms_messages USING btree (campaign_id, subscriber_id);


--
-- Name: sms_messages_provider_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX sms_messages_provider_idx ON commerce.sms_messages USING btree (store_id, provider_id);


--
-- Name: sms_messages_subscriber_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_messages_subscriber_idx ON commerce.sms_messages USING btree (store_id, subscriber_id);


--
-- Name: sms_settings_inbound_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX sms_settings_inbound_key ON commerce.sms_settings USING btree (inbound_key);


--
-- Name: sms_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_settings_updated_by_idx ON commerce.sms_settings USING btree (updated_by);


--
-- Name: sms_subscribers_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_subscribers_customer_idx ON commerce.sms_subscribers USING btree (store_id, customer_id);


--
-- Name: sms_subscribers_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_subscribers_email_idx ON commerce.sms_subscribers USING btree (store_id, email);


--
-- Name: sms_subscribers_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX sms_subscribers_list_idx ON commerce.sms_subscribers USING btree (store_id, status, created_at);


--
-- Name: sms_subscribers_phone_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX sms_subscribers_phone_idx ON commerce.sms_subscribers USING btree (store_id, phone);


--
-- Name: sms_subscribers_token_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX sms_subscribers_token_idx ON commerce.sms_subscribers USING btree (token);


--
-- Name: speed_samples_store_day_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX speed_samples_store_day_idx ON commerce.speed_samples USING btree (store_id, day);


--
-- Name: staff_alert_recipients_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX staff_alert_recipients_account_idx ON commerce.staff_alert_recipients USING btree (account_id);


--
-- Name: staff_alert_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX staff_alert_settings_updated_by_idx ON commerce.staff_alert_settings USING btree (updated_by);


--
-- Name: standing_deliveries_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX standing_deliveries_order_idx ON commerce.standing_deliveries USING btree (store_id, order_id);


--
-- Name: standing_deliveries_store_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX standing_deliveries_store_list_idx ON commerce.standing_deliveries USING btree (store_id, standing_order_id, delivery_date);


--
-- Name: standing_order_lines_store_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX standing_order_lines_store_list_idx ON commerce.standing_order_lines USING btree (store_id, standing_order_id);


--
-- Name: standing_order_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX standing_order_lines_variant_idx ON commerce.standing_order_lines USING btree (store_id, variant_id);


--
-- Name: standing_orders_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX standing_orders_customer_idx ON commerce.standing_orders USING btree (store_id, customer_id);


--
-- Name: standing_orders_one_open; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX standing_orders_one_open ON commerce.standing_orders USING btree (store_id, customer_id) WHERE (status <> 'cancelled'::text);


--
-- Name: standing_orders_schedule_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX standing_orders_schedule_idx ON commerce.standing_orders USING btree (store_id, schedule_id, status);


--
-- Name: status_checks_component_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX status_checks_component_idx ON commerce.status_checks USING btree (component, checked_at);


--
-- Name: status_incident_updates_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX status_incident_updates_created_by_idx ON commerce.status_incident_updates USING btree (created_by);


--
-- Name: status_incident_updates_incident_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX status_incident_updates_incident_idx ON commerce.status_incident_updates USING btree (incident_id, created_at);


--
-- Name: status_incidents_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX status_incidents_created_by_idx ON commerce.status_incidents USING btree (created_by);


--
-- Name: status_incidents_started_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX status_incidents_started_idx ON commerce.status_incidents USING btree (started_at);


--
-- Name: status_subscribers_confirm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX status_subscribers_confirm_idx ON commerce.status_subscribers USING btree (confirm_hash);


--
-- Name: status_subscribers_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX status_subscribers_email_idx ON commerce.status_subscribers USING btree (lower(email));


--
-- Name: status_subscribers_unsubscribe_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX status_subscribers_unsubscribe_idx ON commerce.status_subscribers USING btree (unsubscribe_token);


--
-- Name: stock_alerts_low_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_alerts_low_idx ON commerce.stock_alerts USING btree (store_id, crossed_at) WHERE (state = 'low'::text);


--
-- Name: stock_requests_cancel_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX stock_requests_cancel_idx ON commerce.stock_requests USING btree (cancel_hash);


--
-- Name: stock_requests_confirm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX stock_requests_confirm_idx ON commerce.stock_requests USING btree (confirm_hash);


--
-- Name: stock_requests_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_requests_customer_idx ON commerce.stock_requests USING btree (store_id, customer_id);


--
-- Name: stock_requests_email_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_requests_email_idx ON commerce.stock_requests USING btree (store_id, email);


--
-- Name: stock_requests_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX stock_requests_open_idx ON commerce.stock_requests USING btree (store_id, variant_id, email) WHERE (status = ANY (ARRAY['pending'::text, 'waiting'::text]));


--
-- Name: stock_requests_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_requests_product_idx ON commerce.stock_requests USING btree (store_id, product_id);


--
-- Name: stock_requests_waiting_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_requests_waiting_idx ON commerce.stock_requests USING btree (store_id, variant_id) WHERE (status = 'waiting'::text);


--
-- Name: stock_transfer_lines_transfer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_transfer_lines_transfer_idx ON commerce.stock_transfer_lines USING btree (store_id, transfer_id);


--
-- Name: stock_transfer_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_transfer_lines_variant_idx ON commerce.stock_transfer_lines USING btree (store_id, variant_id);


--
-- Name: stock_transfers_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_transfers_created_by_idx ON commerce.stock_transfers USING btree (created_by);


--
-- Name: stock_transfers_destination_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_transfers_destination_idx ON commerce.stock_transfers USING btree (store_id, destination_id);


--
-- Name: stock_transfers_origin_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_transfers_origin_idx ON commerce.stock_transfers USING btree (store_id, origin_id);


--
-- Name: stock_transfers_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stock_transfers_store_idx ON commerce.stock_transfers USING btree (store_id, created_at DESC NULLS LAST);


--
-- Name: store_billing_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_billing_plan_idx ON commerce.store_billing USING btree (plan_id);


--
-- Name: store_billing_platform_discount_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_billing_platform_discount_idx ON commerce.store_billing USING btree (platform_discount_id);


--
-- Name: store_billing_price_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_billing_price_idx ON commerce.store_billing USING btree (price_id);


--
-- Name: store_billing_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_billing_updated_by_idx ON commerce.store_billing USING btree (updated_by);


--
-- Name: store_business_changes_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_business_changes_created_by_idx ON commerce.store_business_changes USING btree (created_by);


--
-- Name: store_business_changes_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_business_changes_due_idx ON commerce.store_business_changes USING btree (starts_on) WHERE (status = 'planned'::text);


--
-- Name: store_business_changes_planned_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_business_changes_planned_key ON commerce.store_business_changes USING btree (store_id) WHERE (status = 'planned'::text);


--
-- Name: store_business_changes_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_business_changes_store_idx ON commerce.store_business_changes USING btree (store_id, starts_on);


--
-- Name: store_copies_new_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_copies_new_idx ON commerce.store_copies USING btree (new_store_id);


--
-- Name: store_copies_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_copies_open_idx ON commerce.store_copies USING btree (status, claimed_until);


--
-- Name: store_copies_requested_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_copies_requested_by_idx ON commerce.store_copies USING btree (requested_by);


--
-- Name: store_copies_source_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_copies_source_idx ON commerce.store_copies USING btree (source_store_id);


--
-- Name: store_domains_active_hostname_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_domains_active_hostname_idx ON commerce.store_domains USING btree (hostname) WHERE (status = 'active'::text);


--
-- Name: store_domains_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_domains_created_by_idx ON commerce.store_domains USING btree (created_by);


--
-- Name: store_domains_hostname_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_domains_hostname_idx ON commerce.store_domains USING btree (hostname);


--
-- Name: store_domains_language_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_domains_language_idx ON commerce.store_domains USING btree (store_id, language) WHERE (language IS NOT NULL);


--
-- Name: store_domains_market_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_domains_market_idx ON commerce.store_domains USING btree (store_id, market) WHERE (market IS NOT NULL);


--
-- Name: store_domains_primary_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_domains_primary_idx ON commerce.store_domains USING btree (store_id) WHERE is_primary;


--
-- Name: store_domains_store_hostname_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_domains_store_hostname_idx ON commerce.store_domains USING btree (store_id, hostname);


--
-- Name: store_drafts_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_drafts_account_idx ON commerce.store_drafts USING btree (account_id);


--
-- Name: store_drafts_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_drafts_install_idx ON commerce.store_drafts USING btree (install_id);


--
-- Name: store_drafts_one_open; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_drafts_one_open ON commerce.store_drafts USING btree (store_id) WHERE (status = 'drafting'::text);


--
-- Name: store_drafts_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_drafts_store_idx ON commerce.store_drafts USING btree (store_id, created_at);


--
-- Name: store_events_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_events_due_idx ON commerce.store_events USING btree (next_attempt_at) WHERE (((alerts_done_at IS NULL) OR (rules_done_at IS NULL)) AND (failed_at IS NULL));


--
-- Name: store_home_takes_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_home_takes_page_idx ON commerce.store_home_takes USING btree (page_id);


--
-- Name: store_home_takes_previous_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_home_takes_previous_idx ON commerce.store_home_takes USING btree (previous_front_page_id);


--
-- Name: store_home_takes_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_home_takes_store_idx ON commerce.store_home_takes USING btree (store_id, taken_at);


--
-- Name: store_home_takes_taken_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_home_takes_taken_by_idx ON commerce.store_home_takes USING btree (taken_by);


--
-- Name: store_integrations_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_integrations_updated_by_idx ON commerce.store_integrations USING btree (updated_by);


--
-- Name: store_locations_one_office; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_locations_one_office ON commerce.store_locations USING btree (store_id) WHERE (kind = 'office'::text);


--
-- Name: store_locations_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_locations_store_idx ON commerce.store_locations USING btree (store_id, kind, "position");


--
-- Name: store_members_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_members_account_idx ON commerce.store_members USING btree (account_id);


--
-- Name: store_members_invited_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_members_invited_by_idx ON commerce.store_members USING btree (invited_by);


--
-- Name: store_members_role_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_members_role_idx ON commerce.store_members USING btree (store_id, role_id);


--
-- Name: store_roles_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_roles_created_by_idx ON commerce.store_roles USING btree (created_by);


--
-- Name: store_roles_name_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_roles_name_key ON commerce.store_roles USING btree (store_id, lower(name));


--
-- Name: store_roles_template_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_roles_template_key ON commerce.store_roles USING btree (store_id, template) WHERE (template IS NOT NULL);


--
-- Name: store_starters_archived_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_starters_archived_by_idx ON commerce.store_starters USING btree (archived_by);


--
-- Name: store_starters_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_starters_created_by_idx ON commerce.store_starters USING btree (created_by);


--
-- Name: store_starters_design_preset_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_starters_design_preset_idx ON commerce.store_starters USING btree (design_preset_id);


--
-- Name: store_starters_offered_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_starters_offered_idx ON commerce.store_starters USING btree (published, "position");


--
-- Name: store_starters_pack_key_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_starters_pack_key_idx ON commerce.store_starters USING btree (pack_key);


--
-- Name: store_starters_pictures_wanted_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_starters_pictures_wanted_by_idx ON commerce.store_starters USING btree (pictures_wanted_by);


--
-- Name: store_starters_published_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_starters_published_store_idx ON commerce.store_starters USING btree (published_store_id);


--
-- Name: store_starters_recommended_design_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_starters_recommended_design_idx ON commerce.store_starters USING btree (recommended_design);


--
-- Name: store_starters_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_starters_store_idx ON commerce.store_starters USING btree (store_id);


--
-- Name: store_starters_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_starters_updated_by_idx ON commerce.store_starters USING btree (updated_by);


--
-- Name: store_tax_profile_oss_member_state_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_tax_profile_oss_member_state_idx ON commerce.store_tax_profile USING btree (oss_member_state);


--
-- Name: store_tax_profile_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_tax_profile_updated_by_idx ON commerce.store_tax_profile USING btree (updated_by);


--
-- Name: store_tax_profile_vat_check_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_tax_profile_vat_check_idx ON commerce.store_tax_profile USING btree (store_id, vat_number_check_id);


--
-- Name: store_theme_installs_installed_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_theme_installs_installed_by_idx ON commerce.store_theme_installs USING btree (installed_by);


--
-- Name: store_theme_installs_live_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_theme_installs_live_idx ON commerce.store_theme_installs USING btree (store_id) WHERE live;


--
-- Name: store_theme_installs_preset_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_theme_installs_preset_idx ON commerce.store_theme_installs USING btree (preset_id);


--
-- Name: store_theme_installs_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_theme_installs_store_idx ON commerce.store_theme_installs USING btree (store_id, installed_at);


--
-- Name: store_theme_installs_version_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_theme_installs_version_idx ON commerce.store_theme_installs USING btree (version_id);


--
-- Name: store_themes_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_themes_created_by_idx ON commerce.store_themes USING btree (created_by);


--
-- Name: store_themes_name_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX store_themes_name_idx ON commerce.store_themes USING btree (store_id, lower(name));


--
-- Name: store_usage_daily_day_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX store_usage_daily_day_idx ON commerce.store_usage_daily USING btree (day);


--
-- Name: storefront_tokens_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX storefront_tokens_created_by_idx ON commerce.storefront_tokens USING btree (created_by);


--
-- Name: storefront_tokens_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX storefront_tokens_store_idx ON commerce.storefront_tokens USING btree (store_id);


--
-- Name: stores_country_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_country_idx ON commerce.stores USING btree (country);


--
-- Name: stores_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_created_by_idx ON commerce.stores USING btree (created_by);


--
-- Name: stores_footer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_footer_idx ON commerce.stores USING btree (id, footer_id);


--
-- Name: stores_footer_menu_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_footer_menu_idx ON commerce.stores USING btree (id, footer_menu_id);


--
-- Name: stores_front_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_front_page_idx ON commerce.stores USING btree (id, front_page_id);


--
-- Name: stores_header_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_header_idx ON commerce.stores USING btree (id, header_id);


--
-- Name: stores_header_menu_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_header_menu_idx ON commerce.stores USING btree (id, header_menu_id);


--
-- Name: stores_made_from_starter_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_made_from_starter_idx ON commerce.stores USING btree (made_from_starter);


--
-- Name: stores_one_house_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX stores_one_house_idx ON commerce.stores USING btree (house) WHERE house;


--
-- Name: stores_one_template_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX stores_one_template_idx ON commerce.stores USING btree (is_template) WHERE is_template;


--
-- Name: stores_product_layout_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_product_layout_idx ON commerce.stores USING btree (id, product_layout_id);


--
-- Name: stores_products_page_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_products_page_idx ON commerce.stores USING btree (id, products_page_id);


--
-- Name: stores_starter_copy_of_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stores_starter_copy_of_idx ON commerce.stores USING btree (starter_copy_of);


--
-- Name: stripe_accounts_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stripe_accounts_created_by_idx ON commerce.stripe_accounts USING btree (created_by);


--
-- Name: stripe_sync_stripe_id_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX stripe_sync_stripe_id_idx ON commerce.stripe_sync USING btree (mode, stripe_id);


--
-- Name: subscription_lines_selling_plan_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX subscription_lines_selling_plan_idx ON commerce.subscription_lines USING btree (store_id, selling_plan_id);


--
-- Name: subscription_lines_subscription_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX subscription_lines_subscription_idx ON commerce.subscription_lines USING btree (store_id, subscription_id);


--
-- Name: subscription_lines_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX subscription_lines_variant_idx ON commerce.subscription_lines USING btree (store_id, variant_id);


--
-- Name: subscriptions_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX subscriptions_customer_idx ON commerce.subscriptions USING btree (store_id, customer_id);


--
-- Name: subscriptions_first_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX subscriptions_first_order_idx ON commerce.subscriptions USING btree (store_id, first_order_id);


--
-- Name: subscriptions_renewal_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX subscriptions_renewal_idx ON commerce.subscriptions USING btree (current_period_end) WHERE (status = ANY (ARRAY['active'::commerce.subscription_status, 'paused'::commerce.subscription_status]));


--
-- Name: subscriptions_store_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX subscriptions_store_status_idx ON commerce.subscriptions USING btree (store_id, status);


--
-- Name: supplier_invoices_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_invoices_created_by_idx ON commerce.supplier_invoices USING btree (created_by);


--
-- Name: supplier_invoices_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_invoices_entry_idx ON commerce.supplier_invoices USING btree (store_id, entry_id);


--
-- Name: supplier_invoices_number_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX supplier_invoices_number_key ON commerce.supplier_invoices USING btree (store_id, supplier_id, number) WHERE (number IS NOT NULL);


--
-- Name: supplier_invoices_paid_entry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_invoices_paid_entry_idx ON commerce.supplier_invoices USING btree (store_id, paid_entry_id);


--
-- Name: supplier_invoices_store_book_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_invoices_store_book_idx ON commerce.supplier_invoices USING btree (store_id, book_id);


--
-- Name: supplier_invoices_supplier_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_invoices_supplier_idx ON commerce.supplier_invoices USING btree (store_id, supplier_id);


--
-- Name: supplier_invoices_unpaid_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_invoices_unpaid_idx ON commerce.supplier_invoices USING btree (store_id, due_on) WHERE (paid_entry_id IS NULL);


--
-- Name: supplier_order_lines_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_order_lines_line_idx ON commerce.supplier_order_lines USING btree (store_id, order_line_id);


--
-- Name: supplier_order_lines_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_order_lines_order_idx ON commerce.supplier_order_lines USING btree (store_id, supplier_order_id);


--
-- Name: supplier_orders_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_orders_due_idx ON commerce.supplier_orders USING btree (send_after) WHERE (state = 'waiting'::text);


--
-- Name: supplier_orders_order_supplier_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX supplier_orders_order_supplier_key ON commerce.supplier_orders USING btree (store_id, order_id, supplier_id);


--
-- Name: supplier_orders_supplier_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX supplier_orders_supplier_idx ON commerce.supplier_orders USING btree (store_id, supplier_id, created_at DESC NULLS LAST);


--
-- Name: supplier_orders_token_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX supplier_orders_token_key ON commerce.supplier_orders USING btree (token_hash) WHERE (token_hash IS NOT NULL);


--
-- Name: suppliers_api_key_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX suppliers_api_key_key ON commerce.suppliers USING btree (api_key_hash) WHERE (api_key_hash IS NOT NULL);


--
-- Name: suppliers_store_name_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX suppliers_store_name_key ON commerce.suppliers USING btree (store_id, lower(name));


--
-- Name: support_actions_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_actions_conversation_idx ON commerce.support_actions USING btree (conversation_id);


--
-- Name: support_actions_decided_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_actions_decided_by_idx ON commerce.support_actions USING btree (decided_by);


--
-- Name: support_actions_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_actions_open_idx ON commerce.support_actions USING btree (store_id, confirmer) WHERE (status = 'proposed'::text);


--
-- Name: support_agents_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_agents_account_idx ON commerce.support_agents USING btree (account_id);


--
-- Name: support_conversations_about_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_conversations_about_store_idx ON commerce.support_conversations USING btree (about_store_id);


--
-- Name: support_conversations_assignee_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_conversations_assignee_idx ON commerce.support_conversations USING btree (assignee_id) WHERE (status = 'open'::text);


--
-- Name: support_conversations_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_conversations_customer_idx ON commerce.support_conversations USING btree (store_id, customer_id);


--
-- Name: support_conversations_ended_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_conversations_ended_idx ON commerce.support_conversations USING btree (ended_at) WHERE (anonymised_at IS NULL);


--
-- Name: support_conversations_list_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_conversations_list_idx ON commerce.support_conversations USING btree (store_id, status, last_message_at);


--
-- Name: support_conversations_open_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_conversations_open_idx ON commerce.support_conversations USING btree (store_id, handler) WHERE (status = 'open'::text);


--
-- Name: support_conversations_requester_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_conversations_requester_idx ON commerce.support_conversations USING btree (requester_id);


--
-- Name: support_inbound_emails_conversation_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_inbound_emails_conversation_idx ON commerce.support_inbound_emails USING btree (conversation_id);


--
-- Name: support_inbound_emails_from_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_inbound_emails_from_idx ON commerce.support_inbound_emails USING btree (from_address, created_at);


--
-- Name: support_inbound_emails_pending_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_inbound_emails_pending_idx ON commerce.support_inbound_emails USING btree (created_at) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));


--
-- Name: support_inbound_emails_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_inbound_emails_store_idx ON commerce.support_inbound_emails USING btree (store_id, created_at);


--
-- Name: support_messages_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_messages_account_idx ON commerce.support_messages USING btree (account_id);


--
-- Name: support_messages_action_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_messages_action_idx ON commerce.support_messages USING btree (action_id);


--
-- Name: support_messages_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_messages_store_idx ON commerce.support_messages USING btree (store_id);


--
-- Name: support_reads_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_reads_account_idx ON commerce.support_reads USING btree (account_id);


--
-- Name: support_replies_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_replies_created_by_idx ON commerce.support_replies USING btree (created_by);


--
-- Name: support_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX support_settings_updated_by_idx ON commerce.support_settings USING btree (updated_by);


--
-- Name: tax_rate_overrides_set_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX tax_rate_overrides_set_by_idx ON commerce.tax_rate_overrides USING btree (set_by);


--
-- Name: tax_report_exports_exported_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX tax_report_exports_exported_by_idx ON commerce.tax_report_exports USING btree (exported_by);


--
-- Name: tax_report_exports_period_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX tax_report_exports_period_idx ON commerce.tax_report_exports USING btree (store_id, report, period_key, exported_at DESC NULLS LAST);


--
-- Name: template_activations_changed_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX template_activations_changed_by_idx ON commerce.template_activations USING btree (changed_by);


--
-- Name: template_activations_part_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX template_activations_part_idx ON commerce.template_activations USING btree (part_id);


--
-- Name: terms_name_trgm_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX terms_name_trgm_idx ON commerce.terms USING gin (lower(name) extensions.gin_trgm_ops);


--
-- Name: terms_parent_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX terms_parent_idx ON commerce.terms USING btree (parent_id);


--
-- Name: terms_product_layout_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX terms_product_layout_idx ON commerce.terms USING btree (store_id, product_layout_id);


--
-- Name: terms_scope_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX terms_scope_idx ON commerce.terms USING btree (store_id, content_type, kind, "position");


--
-- Name: text_styles_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX text_styles_created_by_idx ON commerce.text_styles USING btree (created_by);


--
-- Name: text_styles_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX text_styles_updated_by_idx ON commerce.text_styles USING btree (updated_by);


--
-- Name: theme_install_updates_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_install_updates_by_idx ON commerce.theme_install_updates USING btree (updated_by);


--
-- Name: theme_install_updates_from_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_install_updates_from_idx ON commerce.theme_install_updates USING btree (from_version_id);


--
-- Name: theme_install_updates_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_install_updates_install_idx ON commerce.theme_install_updates USING btree (install_id);


--
-- Name: theme_install_updates_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_install_updates_store_idx ON commerce.theme_install_updates USING btree (store_id, created_at);


--
-- Name: theme_install_updates_to_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_install_updates_to_idx ON commerce.theme_install_updates USING btree (to_version_id);


--
-- Name: theme_prices_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_prices_updated_by_idx ON commerce.theme_prices USING btree (updated_by);


--
-- Name: theme_purchases_chosen_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_purchases_chosen_by_idx ON commerce.theme_purchases USING btree (chosen_by);


--
-- Name: theme_purchases_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_purchases_due_idx ON commerce.theme_purchases USING btree (due_at) WHERE (status = 'due'::text);


--
-- Name: theme_purchases_one_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX theme_purchases_one_idx ON commerce.theme_purchases USING btree (store_id, preset_id) WHERE (status = ANY (ARRAY['owed'::text, 'due'::text, 'invoiced'::text, 'paid'::text, 'granted'::text]));


--
-- Name: theme_purchases_preset_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_purchases_preset_idx ON commerce.theme_purchases USING btree (preset_id);


--
-- Name: theme_purchases_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_purchases_store_idx ON commerce.theme_purchases USING btree (store_id, created_at);


--
-- Name: theme_schedules_before_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_schedules_before_install_idx ON commerce.theme_schedules USING btree (before_install_id);


--
-- Name: theme_schedules_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_schedules_due_idx ON commerce.theme_schedules USING btree (live_at) WHERE (status = 'waiting'::text);


--
-- Name: theme_schedules_install_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_schedules_install_idx ON commerce.theme_schedules USING btree (install_id);


--
-- Name: theme_schedules_one_revert_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX theme_schedules_one_revert_idx ON commerce.theme_schedules USING btree (store_id) WHERE (revert_status = 'waiting'::text);


--
-- Name: theme_schedules_one_waiting_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX theme_schedules_one_waiting_idx ON commerce.theme_schedules USING btree (store_id) WHERE (status = 'waiting'::text);


--
-- Name: theme_schedules_revert_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_schedules_revert_due_idx ON commerce.theme_schedules USING btree (revert_at) WHERE (revert_status = 'waiting'::text);


--
-- Name: theme_schedules_scheduled_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_schedules_scheduled_by_idx ON commerce.theme_schedules USING btree (scheduled_by);


--
-- Name: theme_schedules_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_schedules_store_idx ON commerce.theme_schedules USING btree (store_id, created_at);


--
-- Name: theme_shots_queue_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_shots_queue_idx ON commerce.theme_shots USING btree (created_at) WHERE (status = ANY (ARRAY['waiting'::text, 'running'::text]));


--
-- Name: theme_submissions_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_submissions_account_idx ON commerce.theme_submissions USING btree (account_id, created_at);


--
-- Name: theme_submissions_content_starter_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_submissions_content_starter_idx ON commerce.theme_submissions USING btree (content_starter_id);


--
-- Name: theme_submissions_decided_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_submissions_decided_by_idx ON commerce.theme_submissions USING btree (decided_by);


--
-- Name: theme_submissions_preset_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_submissions_preset_idx ON commerce.theme_submissions USING btree (preset_id);


--
-- Name: theme_submissions_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_submissions_status_idx ON commerce.theme_submissions USING btree (status, created_at);


--
-- Name: theme_submissions_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX theme_submissions_store_idx ON commerce.theme_submissions USING btree (store_id);


--
-- Name: tripletex_connections_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX tripletex_connections_updated_by_idx ON commerce.tripletex_connections USING btree (updated_by);


--
-- Name: tripletex_sync_attach_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX tripletex_sync_attach_idx ON commerce.tripletex_sync USING btree (store_id, synced_at) WHERE ((attached_at IS NULL) AND (state = 'synced'::text) AND (kind = ANY (ARRAY['shop_invoice'::text, 'shop_credit_note'::text])));


--
-- Name: tripletex_sync_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX tripletex_sync_due_idx ON commerce.tripletex_sync USING btree (store_id, state, next_attempt_at) WHERE (state = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: tripletex_sync_external_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX tripletex_sync_external_key ON commerce.tripletex_sync USING btree (store_id, mode, company_id, external_key) WHERE (external_key IS NOT NULL);


--
-- Name: tripletex_sync_their_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX tripletex_sync_their_idx ON commerce.tripletex_sync USING btree (store_id, kind, their_id);


--
-- Name: turnover_thresholds_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX turnover_thresholds_created_by_idx ON commerce.turnover_thresholds USING btree (created_by);


--
-- Name: unsent_closures_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX unsent_closures_created_by_idx ON commerce.unsent_closures USING btree (created_by);


--
-- Name: unsent_closures_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX unsent_closures_order_idx ON commerce.unsent_closures USING btree (store_id, order_id);


--
-- Name: unsent_closures_order_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX unsent_closures_order_line_idx ON commerce.unsent_closures USING btree (store_id, order_line_id);


--
-- Name: unsent_closures_refund_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX unsent_closures_refund_idx ON commerce.unsent_closures USING btree (store_id, refund_id) WHERE (refund_id IS NOT NULL);


--
-- Name: variant_cost_history_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX variant_cost_history_order_idx ON commerce.variant_cost_history USING btree (store_id, purchase_order_id) WHERE (purchase_order_id IS NOT NULL);


--
-- Name: variant_cost_history_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX variant_cost_history_variant_idx ON commerce.variant_cost_history USING btree (store_id, variant_id, id DESC NULLS LAST);


--
-- Name: vat_categories_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX vat_categories_updated_by_idx ON commerce.vat_categories USING btree (updated_by);


--
-- Name: vat_checks_cart_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX vat_checks_cart_idx ON commerce.vat_checks USING btree (store_id, cart_id, requested_at);


--
-- Name: vat_checks_number_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX vat_checks_number_idx ON commerce.vat_checks USING btree (store_id, number, requested_at DESC NULLS LAST);


--
-- Name: vat_rates_category_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX vat_rates_category_idx ON commerce.vat_rates USING btree (category);


--
-- Name: vat_rates_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX vat_rates_created_by_idx ON commerce.vat_rates USING btree (created_by);


--
-- Name: vat_rates_verified_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX vat_rates_verified_by_idx ON commerce.vat_rates USING btree (verified_by);


--
-- Name: visits_store_day_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX visits_store_day_idx ON commerce.visits USING btree (store_id, day);


--
-- Name: webhook_endpoints_app_grant_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX webhook_endpoints_app_grant_key ON commerce.webhook_endpoints USING btree (app_grant_id);


--
-- Name: webhook_endpoints_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX webhook_endpoints_created_by_idx ON commerce.webhook_endpoints USING btree (created_by);


--
-- Name: webhook_endpoints_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX webhook_endpoints_store_idx ON commerce.webhook_endpoints USING btree (store_id);


--
-- Name: webhook_events_unprocessed_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX webhook_events_unprocessed_idx ON commerce.webhook_events USING btree (received_at) WHERE (processed_at IS NULL);


--
-- Name: wishlist_cart_adds_cart_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_cart_adds_cart_idx ON commerce.wishlist_cart_adds USING btree (store_id, cart_id);


--
-- Name: wishlist_cart_adds_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_cart_adds_customer_idx ON commerce.wishlist_cart_adds USING btree (store_id, customer_id);


--
-- Name: wishlist_cart_adds_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_cart_adds_product_idx ON commerce.wishlist_cart_adds USING btree (store_id, product_id);


--
-- Name: wishlist_cart_adds_store_created_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_cart_adds_store_created_idx ON commerce.wishlist_cart_adds USING btree (store_id, created_at);


--
-- Name: wishlist_cart_adds_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_cart_adds_variant_idx ON commerce.wishlist_cart_adds USING btree (store_id, variant_id);


--
-- Name: wishlist_cart_adds_wishlist_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_cart_adds_wishlist_idx ON commerce.wishlist_cart_adds USING btree (store_id, wishlist_id);


--
-- Name: wishlist_items_product_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_items_product_idx ON commerce.wishlist_items USING btree (store_id, product_id);


--
-- Name: wishlist_items_variant_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlist_items_variant_idx ON commerce.wishlist_items USING btree (variant_id);


--
-- Name: wishlists_browser_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlists_browser_idx ON commerce.wishlists USING btree (store_id, browser_token_hash);


--
-- Name: wishlists_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wishlists_customer_idx ON commerce.wishlists USING btree (store_id, customer_id);


--
-- Name: withdrawal_attempts_at_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX withdrawal_attempts_at_idx ON commerce.withdrawal_attempts USING btree (at);


--
-- Name: withdrawal_attempts_key_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX withdrawal_attempts_key_idx ON commerce.withdrawal_attempts USING btree (store_id, key_kind, key_hash, at);


--
-- Name: withdrawal_request_lines_order_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX withdrawal_request_lines_order_line_idx ON commerce.withdrawal_request_lines USING btree (store_id, order_line_id);


--
-- Name: withdrawal_request_lines_request_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX withdrawal_request_lines_request_idx ON commerce.withdrawal_request_lines USING btree (store_id, withdrawal_request_id);


--
-- Name: withdrawal_requests_expiry_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX withdrawal_requests_expiry_idx ON commerce.withdrawal_requests USING btree (expires_at) WHERE (confirmed_at IS NULL);


--
-- Name: withdrawal_requests_order_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX withdrawal_requests_order_idx ON commerce.withdrawal_requests USING btree (store_id, order_id);


--
-- Name: wordpress_connections_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX wordpress_connections_account_idx ON commerce.wordpress_connections USING btree (account_id);


--
-- Name: wordpress_connections_code_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX wordpress_connections_code_idx ON commerce.wordpress_connections USING btree (code_hash);


--
-- Name: wordpress_connections_token_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX wordpress_connections_token_idx ON commerce.wordpress_connections USING btree (token_hash);


--
-- Name: work_assignments_client_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_assignments_client_idx ON commerce.work_assignments USING btree (store_id, client_id, sort_order);


--
-- Name: work_assignments_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_assignments_created_by_idx ON commerce.work_assignments USING btree (created_by);


--
-- Name: work_assignments_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_assignments_status_idx ON commerce.work_assignments USING btree (store_id, status);


--
-- Name: work_clients_company_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_clients_company_idx ON commerce.work_clients USING btree (store_id, customer_company_id);


--
-- Name: work_clients_country_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_clients_country_idx ON commerce.work_clients USING btree (country);


--
-- Name: work_clients_customer_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_clients_customer_idx ON commerce.work_clients USING btree (store_id, customer_id);


--
-- Name: work_clients_sort_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_clients_sort_idx ON commerce.work_clients USING btree (store_id, sort_order, name);


--
-- Name: work_credit_notes_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_credit_notes_created_by_idx ON commerce.work_credit_notes USING btree (created_by);


--
-- Name: work_credit_notes_invoice_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_credit_notes_invoice_idx ON commerce.work_credit_notes USING btree (store_id, invoice_id);


--
-- Name: work_events_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_events_account_idx ON commerce.work_events USING btree (account_id);


--
-- Name: work_events_entity_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_events_entity_idx ON commerce.work_events USING btree (store_id, entity_type, entity_id, created_at);


--
-- Name: work_events_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_events_store_idx ON commerce.work_events USING btree (store_id, created_at);


--
-- Name: work_invoice_lines_assignment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoice_lines_assignment_idx ON commerce.work_invoice_lines USING btree (store_id, assignment_id) WHERE (assignment_id IS NOT NULL);


--
-- Name: work_invoice_lines_invoice_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoice_lines_invoice_idx ON commerce.work_invoice_lines USING btree (store_id, invoice_id, "position");


--
-- Name: work_invoice_lines_task_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoice_lines_task_idx ON commerce.work_invoice_lines USING btree (store_id, task_id) WHERE (task_id IS NOT NULL);


--
-- Name: work_invoice_losses_invoice_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoice_losses_invoice_idx ON commerce.work_invoice_losses USING btree (store_id, invoice_id, written_off_on);


--
-- Name: work_invoice_losses_recorded_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoice_losses_recorded_by_idx ON commerce.work_invoice_losses USING btree (recorded_by);


--
-- Name: work_invoice_losses_reverses_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX work_invoice_losses_reverses_idx ON commerce.work_invoice_losses USING btree (store_id, reverses) WHERE (reverses IS NOT NULL);


--
-- Name: work_invoice_payments_invoice_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoice_payments_invoice_idx ON commerce.work_invoice_payments USING btree (store_id, invoice_id, received_on);


--
-- Name: work_invoice_payments_provider_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX work_invoice_payments_provider_idx ON commerce.work_invoice_payments USING btree (store_id, provider_reference) WHERE (provider_reference IS NOT NULL);


--
-- Name: work_invoice_payments_recorded_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoice_payments_recorded_by_idx ON commerce.work_invoice_payments USING btree (recorded_by);


--
-- Name: work_invoice_payments_reverses_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX work_invoice_payments_reverses_idx ON commerce.work_invoice_payments USING btree (store_id, reverses) WHERE (reverses IS NOT NULL);


--
-- Name: work_invoices_assignment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoices_assignment_idx ON commerce.work_invoices USING btree (store_id, assignment_id);


--
-- Name: work_invoices_client_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoices_client_idx ON commerce.work_invoices USING btree (store_id, client_id, status);


--
-- Name: work_invoices_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoices_created_by_idx ON commerce.work_invoices USING btree (created_by);


--
-- Name: work_invoices_document_number_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX work_invoices_document_number_key ON commerce.work_invoices USING btree (store_id, document_number) WHERE ((NOT imported) OR (legacy_number IS NOT NULL));


--
-- Name: work_invoices_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoices_due_idx ON commerce.work_invoices USING btree (store_id, due_on) WHERE (status = 'sent'::text);


--
-- Name: work_invoices_legacy_number_key; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX work_invoices_legacy_number_key ON commerce.work_invoices USING btree (store_id, legacy_number) WHERE (legacy_number IS NOT NULL);


--
-- Name: work_invoices_one_draft_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX work_invoices_one_draft_idx ON commerce.work_invoices USING btree (store_id, assignment_id) WHERE (status = 'draft'::text);


--
-- Name: work_invoices_status_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_invoices_status_idx ON commerce.work_invoices USING btree (store_id, status, issued_on DESC NULLS LAST);


--
-- Name: work_recurring_invoices_client_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_recurring_invoices_client_idx ON commerce.work_recurring_invoices USING btree (store_id, client_id, sort_order, name);


--
-- Name: work_settings_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_settings_updated_by_idx ON commerce.work_settings USING btree (updated_by);


--
-- Name: work_tasks_sort_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_tasks_sort_idx ON commerce.work_tasks USING btree (store_id, assignment_id, sort_order);


--
-- Name: work_time_entries_account_date_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_time_entries_account_date_idx ON commerce.work_time_entries USING btree (store_id, account_id, work_date DESC);


--
-- Name: work_time_entries_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_time_entries_account_idx ON commerce.work_time_entries USING btree (account_id);


--
-- Name: work_time_entries_assignment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_time_entries_assignment_idx ON commerce.work_time_entries USING btree (store_id, assignment_id, work_date DESC);


--
-- Name: work_time_entries_date_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_time_entries_date_idx ON commerce.work_time_entries USING btree (store_id, work_date DESC);


--
-- Name: work_time_entries_line_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_time_entries_line_idx ON commerce.work_time_entries USING btree (store_id, invoice_line_id);


--
-- Name: work_time_entries_task_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_time_entries_task_idx ON commerce.work_time_entries USING btree (store_id, assignment_id, task_id);


--
-- Name: work_timers_account_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE UNIQUE INDEX work_timers_account_idx ON commerce.work_timers USING btree (account_id);


--
-- Name: work_timers_assignment_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX work_timers_assignment_idx ON commerce.work_timers USING btree (store_id, assignment_id, task_id);


--
-- Name: workflow_runs_due_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX workflow_runs_due_idx ON commerce.workflow_runs USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: workflow_runs_store_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX workflow_runs_store_idx ON commerce.workflow_runs USING btree (store_id, created_at);


--
-- Name: workflow_runs_workflow_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX workflow_runs_workflow_idx ON commerce.workflow_runs USING btree (workflow_id, created_at);


--
-- Name: workflows_created_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX workflows_created_by_idx ON commerce.workflows USING btree (created_by);


--
-- Name: workflows_store_trigger_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX workflows_store_trigger_idx ON commerce.workflows USING btree (store_id, trigger) WHERE enabled;


--
-- Name: workflows_updated_by_idx; Type: INDEX; Schema: commerce; Owner: -
--

CREATE INDEX workflows_updated_by_idx ON commerce.workflows USING btree (updated_by);


--
-- Name: access_requests access_requests_referral; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER access_requests_referral AFTER UPDATE OF store_id ON commerce.access_requests FOR EACH ROW WHEN (((old.store_id IS NULL) AND (new.store_id IS NOT NULL) AND (new.referral_code IS NOT NULL))) EXECUTE FUNCTION commerce.access_requests_referral();


--
-- Name: account_recovery_codes account_recovery_codes_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER account_recovery_codes_guard BEFORE UPDATE ON commerce.account_recovery_codes FOR EACH ROW EXECUTE FUNCTION commerce.guard_recovery_code();


--
-- Name: accounts accounts_house_members; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER accounts_house_members AFTER INSERT OR UPDATE OF platform_admin, platform_role, disabled_at ON commerce.accounts FOR EACH ROW EXECUTE FUNCTION commerce.house_members_sync();


--
-- Name: accounts accounts_house_members_gone; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER accounts_house_members_gone BEFORE DELETE ON commerce.accounts FOR EACH ROW EXECUTE FUNCTION commerce.accounts_house_members_gone();


--
-- Name: affiliate_attributions affiliate_attributions_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER affiliate_attributions_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.affiliate_attributions FOR EACH ROW EXECUTE FUNCTION commerce.affiliate_attributions_guard();


--
-- Name: analytics_targets analytics_targets_forms; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER analytics_targets_forms BEFORE INSERT OR UPDATE ON commerce.analytics_targets FOR EACH ROW EXECUTE FUNCTION commerce.analytics_targets_forms();


--
-- Name: assistant_plan_steps assistant_plan_steps_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER assistant_plan_steps_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.assistant_plan_steps FOR EACH ROW EXECUTE FUNCTION commerce.autopilot_steps_rules();


--
-- Name: assistant_plans assistant_plans_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER assistant_plans_rules BEFORE UPDATE ON commerce.assistant_plans FOR EACH ROW EXECUTE FUNCTION commerce.autopilot_plans_rules();


--
-- Name: audit_log audit_log_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER audit_log_guard BEFORE DELETE OR UPDATE ON commerce.audit_log FOR EACH ROW WHEN ((NOT commerce.sandbox_purging(old.store_id))) EXECUTE FUNCTION commerce.guard_audit_log();


--
-- Name: automations automations_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER automations_rules BEFORE UPDATE ON commerce.automations FOR EACH ROW EXECUTE FUNCTION commerce.automations_rules();


--
-- Name: blog_comments blog_comments_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER blog_comments_rules BEFORE UPDATE ON commerce.blog_comments FOR EACH ROW EXECUTE FUNCTION commerce.blog_comments_rules();


--
-- Name: blogs blogs_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER blogs_rules BEFORE INSERT OR UPDATE ON commerce.blogs FOR EACH ROW EXECUTE FUNCTION commerce.blogs_rules();


--
-- Name: bonus_allocations bonus_allocations_immutable; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER bonus_allocations_immutable BEFORE DELETE OR UPDATE ON commerce.bonus_allocations FOR EACH ROW EXECUTE FUNCTION commerce.bonus_ledger_immutable();


--
-- Name: bonus_allocations bonus_allocations_within_lot; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER bonus_allocations_within_lot AFTER INSERT ON commerce.bonus_allocations FOR EACH ROW EXECUTE FUNCTION commerce.bonus_allocation_within_lot();


--
-- Name: bonus_entries bonus_entries_fully_allocated; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER bonus_entries_fully_allocated AFTER INSERT ON commerce.bonus_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.bonus_entry_fully_allocated();


--
-- Name: bonus_entries bonus_entries_immutable; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER bonus_entries_immutable BEFORE DELETE OR UPDATE ON commerce.bonus_entries FOR EACH ROW EXECUTE FUNCTION commerce.bonus_ledger_immutable();


--
-- Name: bonus_settings bonus_settings_pause; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER bonus_settings_pause BEFORE INSERT OR UPDATE OF enabled ON commerce.bonus_settings FOR EACH ROW EXECUTE FUNCTION commerce.bonus_settings_pause();


--
-- Name: bookings bookings_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER bookings_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.bookings FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: books_inbox books_inbox_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER books_inbox_fixed BEFORE DELETE OR UPDATE ON commerce.books_inbox FOR EACH ROW EXECUTE FUNCTION commerce.books_inbox_fixed();


--
-- Name: broadcast_recipients broadcast_recipients_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER broadcast_recipients_rules BEFORE INSERT OR UPDATE ON commerce.broadcast_recipients FOR EACH ROW EXECUTE FUNCTION commerce.broadcast_recipients_rules();


--
-- Name: broadcasts broadcasts_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER broadcasts_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.broadcasts FOR EACH ROW EXECUTE FUNCTION commerce.broadcasts_rules();


--
-- Name: bulk_edit_batches bulk_edit_batches_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER bulk_edit_batches_rules BEFORE INSERT OR UPDATE ON commerce.bulk_edit_batches FOR EACH ROW EXECUTE FUNCTION commerce.bulk_edit_batches_rules();


--
-- Name: bulk_edit_items bulk_edit_items_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER bulk_edit_items_rules BEFORE UPDATE ON commerce.bulk_edit_items FOR EACH ROW EXECUTE FUNCTION commerce.bulk_edit_items_rules();


--
-- Name: bundle_components bundle_components_on_request; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER bundle_components_on_request AFTER INSERT OR UPDATE ON commerce.bundle_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.bundle_components_on_request();


--
-- Name: bundle_components bundle_components_refresh; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER bundle_components_refresh AFTER INSERT OR DELETE OR UPDATE ON commerce.bundle_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.bundle_components_refresh();


--
-- Name: bundle_components bundle_components_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER bundle_components_rules AFTER INSERT OR UPDATE ON commerce.bundle_components DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.bundle_components_rules();


--
-- Name: carts carts_delivery_note_follows; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER carts_delivery_note_follows BEFORE UPDATE OF local_area_id ON commerce.carts FOR EACH ROW EXECUTE FUNCTION commerce.carts_delivery_note_follows();


--
-- Name: company_location_buyers company_location_buyers_member; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER company_location_buyers_member BEFORE INSERT OR UPDATE ON commerce.company_location_buyers FOR EACH ROW EXECUTE FUNCTION commerce.company_location_buyers_member();


--
-- Name: company_locations company_locations_max; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER company_locations_max AFTER INSERT ON commerce.company_locations FOR EACH ROW EXECUTE FUNCTION commerce.company_locations_max();


--
-- Name: content_entries content_entries_leave_redirect; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER content_entries_leave_redirect AFTER UPDATE OF slug ON commerce.content_entries FOR EACH ROW EXECUTE FUNCTION commerce.content_entries_leave_redirect();


--
-- Name: content_entries content_entries_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER content_entries_rules BEFORE INSERT OR UPDATE ON commerce.content_entries FOR EACH ROW EXECUTE FUNCTION commerce.content_entries_rules();


--
-- Name: content_entries content_entries_taken_address; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER content_entries_taken_address AFTER INSERT OR UPDATE OF slug ON commerce.content_entries FOR EACH ROW EXECUTE FUNCTION commerce.content_entries_taken_address();


--
-- Name: content_types content_types_layout; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER content_types_layout BEFORE INSERT OR UPDATE OF layout_id ON commerce.content_types FOR EACH ROW EXECUTE FUNCTION commerce.content_types_layout();


--
-- Name: content_types content_types_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER content_types_rules BEFORE INSERT OR UPDATE ON commerce.content_types FOR EACH ROW EXECUTE FUNCTION commerce.content_types_rules();


--
-- Name: creator_attributions creator_attributions_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER creator_attributions_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.creator_attributions FOR EACH ROW EXECUTE FUNCTION commerce.creator_attributions_rules();


--
-- Name: creator_commissions creator_commissions_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER creator_commissions_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.creator_commissions FOR EACH ROW EXECUTE FUNCTION commerce.creator_ledger_guard();


--
-- Name: creator_payouts creator_payouts_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER creator_payouts_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.creator_payouts FOR EACH ROW EXECUTE FUNCTION commerce.creator_ledger_guard();


--
-- Name: creators creators_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER creators_rules BEFORE INSERT OR UPDATE ON commerce.creators FOR EACH ROW EXECUTE FUNCTION commerce.creators_rules();


--
-- Name: credit_notes credit_notes_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER credit_notes_append_only BEFORE DELETE OR UPDATE ON commerce.credit_notes FOR EACH ROW EXECUTE FUNCTION commerce.guard_document_change();


--
-- Name: credit_notes credit_notes_insert_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER credit_notes_insert_guard BEFORE INSERT ON commerce.credit_notes FOR EACH ROW EXECUTE FUNCTION commerce.document_insert_guard();


--
-- Name: credit_notes credit_notes_po_number; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER credit_notes_po_number BEFORE INSERT ON commerce.credit_notes FOR EACH ROW EXECUTE FUNCTION commerce.documents_po_number();


--
-- Name: customer_addresses customer_addresses_max; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER customer_addresses_max BEFORE INSERT ON commerce.customer_addresses FOR EACH ROW EXECUTE FUNCTION commerce.customer_addresses_max();


--
-- Name: customer_notes customer_notes_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER customer_notes_rules BEFORE UPDATE ON commerce.customer_notes FOR EACH ROW EXECUTE FUNCTION commerce.customer_notes_rules();


--
-- Name: customer_tags customer_tags_limit; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER customer_tags_limit BEFORE INSERT ON commerce.customer_tags FOR EACH ROW EXECUTE FUNCTION commerce.customer_tags_limit();


--
-- Name: customers customers_bonus_signup; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER customers_bonus_signup AFTER INSERT OR UPDATE OF email_verified_at ON commerce.customers FOR EACH ROW EXECUTE FUNCTION commerce.bonus_signup_grant();


--
-- Name: customers customers_forget_field_values; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER customers_forget_field_values AFTER DELETE ON commerce.customers FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('customer');


--
-- Name: customers customers_leave_locations; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER customers_leave_locations AFTER UPDATE OF company_id, company_role ON commerce.customers FOR EACH ROW WHEN (((old.company_id IS DISTINCT FROM new.company_id) OR (old.company_role IS DISTINCT FROM new.company_role))) EXECUTE FUNCTION commerce.customers_leave_locations();


--
-- Name: customers customers_referred_by_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER customers_referred_by_guard BEFORE INSERT OR UPDATE OF referred_by_customer_id ON commerce.customers FOR EACH ROW EXECUTE FUNCTION commerce.customers_referred_by_guard();


--
-- Name: data_jobs data_jobs_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER data_jobs_rules BEFORE INSERT OR UPDATE ON commerce.data_jobs FOR EACH ROW EXECUTE FUNCTION commerce.data_jobs_rules();


--
-- Name: deal_links deal_links_quote_sent; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER deal_links_quote_sent AFTER INSERT ON commerce.deal_links FOR EACH ROW WHEN ((new.kind = 'draft'::text)) EXECUTE FUNCTION commerce.deal_links_quote_sent();


--
-- Name: deal_links deal_links_win; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER deal_links_win AFTER INSERT ON commerce.deal_links FOR EACH ROW EXECUTE FUNCTION commerce.deal_links_win();


--
-- Name: deals deals_forget_field_values; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER deals_forget_field_values AFTER DELETE ON commerce.deals FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('deal');


--
-- Name: deals deals_history; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER deals_history AFTER INSERT OR UPDATE OF stage_id, status ON commerce.deals FOR EACH ROW EXECUTE FUNCTION commerce.deals_history();


--
-- Name: deals deals_stage_clock; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER deals_stage_clock BEFORE UPDATE OF stage_id ON commerce.deals FOR EACH ROW EXECUTE FUNCTION commerce.deals_stage_clock();


--
-- Name: design_preset_uses design_preset_uses_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER design_preset_uses_rules BEFORE DELETE OR UPDATE ON commerce.design_preset_uses FOR EACH ROW WHEN ((NOT commerce.sandbox_purging(old.store_id))) EXECUTE FUNCTION commerce.design_preset_uses_rules();


--
-- Name: design_preset_versions design_preset_versions_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER design_preset_versions_rules BEFORE DELETE OR UPDATE ON commerce.design_preset_versions FOR EACH ROW EXECUTE FUNCTION commerce.design_preset_versions_rules();


--
-- Name: design_presets design_presets_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER design_presets_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.design_presets FOR EACH ROW EXECUTE FUNCTION commerce.design_presets_rules();


--
-- Name: design_variations design_variations_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER design_variations_rules BEFORE INSERT OR UPDATE ON commerce.design_variations FOR EACH ROW EXECUTE FUNCTION commerce.design_variations_rules();


--
-- Name: discount_code_items discount_code_items_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER discount_code_items_fixed BEFORE UPDATE ON commerce.discount_code_items FOR EACH ROW EXECUTE FUNCTION commerce.discount_code_items_fixed();


--
-- Name: discount_code_items discount_code_items_text_unique; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER discount_code_items_text_unique BEFORE INSERT OR UPDATE OF code ON commerce.discount_code_items FOR EACH ROW EXECUTE FUNCTION commerce.discount_code_text_unique();


--
-- Name: discount_codes discount_codes_text_unique; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER discount_codes_text_unique BEFORE INSERT OR UPDATE OF code ON commerce.discount_codes FOR EACH ROW EXECUTE FUNCTION commerce.discount_code_text_unique();


--
-- Name: dispute_evidence dispute_evidence_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER dispute_evidence_guard BEFORE UPDATE ON commerce.dispute_evidence FOR EACH ROW EXECUTE FUNCTION commerce.dispute_evidence_guard();


--
-- Name: dns_changes dns_changes_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER dns_changes_rules BEFORE DELETE OR UPDATE ON commerce.dns_changes FOR EACH ROW EXECUTE FUNCTION commerce.dns_changes_rules();


--
-- Name: dns_zones dns_zones_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER dns_zones_rules BEFORE DELETE OR UPDATE ON commerce.dns_zones FOR EACH ROW EXECUTE FUNCTION commerce.dns_zones_rules();


--
-- Name: document_series document_series_sales_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER document_series_sales_guard BEFORE DELETE OR UPDATE ON commerce.document_series FOR EACH ROW EXECUTE FUNCTION commerce.sales_series_guard();


--
-- Name: document_series document_series_work_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER document_series_work_guard BEFORE UPDATE ON commerce.document_series FOR EACH ROW EXECUTE FUNCTION commerce.work_series_guard();


--
-- Name: domain_purchases domain_purchases_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER domain_purchases_rules BEFORE DELETE OR UPDATE ON commerce.domain_purchases FOR EACH ROW EXECUTE FUNCTION commerce.domain_purchases_rules();


--
-- Name: domain_registrations domain_registrations_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER domain_registrations_rules BEFORE DELETE OR UPDATE ON commerce.domain_registrations FOR EACH ROW EXECUTE FUNCTION commerce.domain_registrations_rules();


--
-- Name: draft_order_lines draft_order_lines_limit; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER draft_order_lines_limit BEFORE INSERT ON commerce.draft_order_lines FOR EACH ROW EXECUTE FUNCTION commerce.draft_order_lines_limit();


--
-- Name: draft_order_lines draft_order_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER draft_order_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.draft_order_lines FOR EACH ROW EXECUTE FUNCTION commerce.draft_order_lines_rules();


--
-- Name: draft_orders draft_orders_quote_sent; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER draft_orders_quote_sent AFTER UPDATE OF sent_at ON commerce.draft_orders FOR EACH ROW WHEN (((old.sent_at IS NULL) AND (new.sent_at IS NOT NULL))) EXECUTE FUNCTION commerce.draft_orders_quote_sent();


--
-- Name: draft_orders draft_orders_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER draft_orders_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.draft_orders FOR EACH ROW EXECUTE FUNCTION commerce.draft_orders_rules();


--
-- Name: ecb_reference_rates ecb_reference_rates_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ecb_reference_rates_append_only BEFORE DELETE OR UPDATE ON commerce.ecb_reference_rates FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: email_messages email_messages_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER email_messages_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.email_messages FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: experiment_events experiment_events_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER experiment_events_guard BEFORE INSERT OR UPDATE ON commerce.experiment_events FOR EACH ROW EXECUTE FUNCTION commerce.experiment_events_guard();


--
-- Name: experiment_exposures experiment_exposures_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER experiment_exposures_guard BEFORE INSERT OR UPDATE ON commerce.experiment_exposures FOR EACH ROW EXECUTE FUNCTION commerce.experiment_exposures_guard();


--
-- Name: experiment_variants experiment_variants_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER experiment_variants_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.experiment_variants FOR EACH ROW EXECUTE FUNCTION commerce.experiment_variants_guard();


--
-- Name: experiments experiments_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER experiments_guard BEFORE INSERT OR UPDATE ON commerce.experiments FOR EACH ROW EXECUTE FUNCTION commerce.experiments_guard();


--
-- Name: experiments experiments_no_delete; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER experiments_no_delete BEFORE DELETE ON commerce.experiments FOR EACH ROW EXECUTE FUNCTION commerce.experiments_no_delete();


--
-- Name: gift_card_entries gift_card_entries_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER gift_card_entries_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.gift_card_entries FOR EACH ROW EXECUTE FUNCTION commerce.gift_card_entries_rules();


--
-- Name: gift_card_entries gift_card_entries_writer; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER gift_card_entries_writer BEFORE INSERT ON commerce.gift_card_entries FOR EACH ROW EXECUTE FUNCTION commerce.gift_card_writer();


--
-- Name: gift_cards gift_cards_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER gift_cards_rules BEFORE DELETE OR UPDATE ON commerce.gift_cards FOR EACH ROW EXECUTE FUNCTION commerce.gift_cards_rules();


--
-- Name: gift_cards gift_cards_writer; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER gift_cards_writer BEFORE INSERT ON commerce.gift_cards FOR EACH ROW EXECUTE FUNCTION commerce.gift_card_writer();


--
-- Name: host_commissions host_commissions_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER host_commissions_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.host_commissions FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: hosts hosts_vat_follow; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER hosts_vat_follow AFTER UPDATE OF vat_registered ON commerce.hosts FOR EACH ROW EXECUTE FUNCTION commerce.hosts_vat_follow();


--
-- Name: house_customer_links house_customer_links_house; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER house_customer_links_house BEFORE INSERT OR UPDATE OF store_id ON commerce.house_customer_links FOR EACH ROW EXECUTE FUNCTION commerce.house_customer_links_house();


--
-- Name: house_site_copies house_site_copies_house; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER house_site_copies_house BEFORE INSERT OR UPDATE OF store_id ON commerce.house_site_copies FOR EACH ROW EXECUTE FUNCTION commerce.house_site_copies_house();


--
-- Name: customers integration_customer_change_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_customer_change_events AFTER UPDATE OF email, name, phone, address, company_name, organisation_number ON commerce.customers FOR EACH ROW EXECUTE FUNCTION commerce.integration_customer_change_events();


--
-- Name: customers integration_customer_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_customer_events AFTER INSERT ON commerce.customers FOR EACH ROW EXECUTE FUNCTION commerce.integration_customer_events();


--
-- Name: discount_codes integration_discount_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_discount_events AFTER INSERT ON commerce.discount_codes FOR EACH ROW EXECUTE FUNCTION commerce.integration_discount_events();


--
-- Name: draft_orders integration_draft_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_draft_events AFTER INSERT OR UPDATE OF status ON commerce.draft_orders FOR EACH ROW EXECUTE FUNCTION commerce.integration_draft_events();


--
-- Name: gift_cards integration_gift_card_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_gift_card_events AFTER INSERT ON commerce.gift_cards FOR EACH ROW EXECUTE FUNCTION commerce.integration_gift_card_events();


--
-- Name: inventory_levels integration_inventory_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_inventory_events AFTER INSERT OR UPDATE OF on_hand ON commerce.inventory_levels FOR EACH ROW EXECUTE FUNCTION commerce.integration_inventory_events();


--
-- Name: orders integration_order_edit_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_order_edit_events AFTER UPDATE OF edited_at ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.integration_order_edit_events();


--
-- Name: orders integration_order_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_order_events AFTER INSERT OR UPDATE OF status ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.integration_order_events();


--
-- Name: products integration_product_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_product_events AFTER INSERT OR UPDATE ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.integration_product_events();


--
-- Name: refunds integration_refund_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_refund_events AFTER INSERT OR UPDATE OF status ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.integration_refund_events();


--
-- Name: returns integration_return_changes; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_return_changes AFTER UPDATE OF status ON commerce.returns FOR EACH ROW EXECUTE FUNCTION commerce.integration_return_events();


--
-- Name: returns integration_return_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_return_events AFTER INSERT ON commerce.returns FOR EACH ROW EXECUTE FUNCTION commerce.integration_return_events();


--
-- Name: product_reviews integration_review_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_review_events AFTER INSERT ON commerce.product_reviews FOR EACH ROW EXECUTE FUNCTION commerce.integration_review_events();


--
-- Name: shipments integration_shipment_changes; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_shipment_changes AFTER UPDATE OF tracking_number, tracking_url, carrier, undone_at ON commerce.shipments FOR EACH ROW EXECUTE FUNCTION commerce.integration_shipment_events();


--
-- Name: shipments integration_shipment_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_shipment_events AFTER INSERT ON commerce.shipments FOR EACH ROW EXECUTE FUNCTION commerce.integration_shipment_events();


--
-- Name: stock_alerts integration_stock_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_stock_events AFTER INSERT OR UPDATE OF state ON commerce.stock_alerts FOR EACH ROW EXECUTE FUNCTION commerce.integration_stock_events();


--
-- Name: subscriptions integration_subscription_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_subscription_events AFTER UPDATE OF status ON commerce.subscriptions FOR EACH ROW EXECUTE FUNCTION commerce.integration_subscription_events();


--
-- Name: shipment_tracking integration_tracking_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_tracking_events AFTER INSERT OR UPDATE OF phase, delivered_at ON commerce.shipment_tracking FOR EACH ROW EXECUTE FUNCTION commerce.integration_tracking_events();


--
-- Name: withdrawal_requests integration_withdrawal_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_withdrawal_events AFTER UPDATE OF confirmed_at ON commerce.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION commerce.integration_withdrawal_events();


--
-- Name: work_clients integration_work_client_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_work_client_events AFTER INSERT ON commerce.work_clients FOR EACH ROW EXECUTE FUNCTION commerce.integration_work_client_events();


--
-- Name: work_invoices integration_work_invoice_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER integration_work_invoice_events AFTER UPDATE OF status ON commerce.work_invoices FOR EACH ROW EXECUTE FUNCTION commerce.integration_work_invoice_events();


--
-- Name: inventory_levels inventory_levels_movement; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_levels_movement AFTER INSERT OR DELETE OR UPDATE OF on_hand ON commerce.inventory_levels FOR EACH ROW EXECUTE FUNCTION commerce.record_inventory_movement();


--
-- Name: inventory_levels inventory_levels_not_bundle; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_levels_not_bundle BEFORE INSERT ON commerce.inventory_levels FOR EACH ROW EXECUTE FUNCTION commerce.inventory_levels_not_bundle();


--
-- Name: inventory_levels inventory_levels_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_levels_rules BEFORE INSERT OR UPDATE OF on_hand ON commerce.inventory_levels FOR EACH ROW EXECUTE FUNCTION commerce.inventory_levels_rules();


--
-- Name: inventory_locations inventory_locations_alerts; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_locations_alerts AFTER UPDATE OF active ON commerce.inventory_locations FOR EACH ROW WHEN ((old.active IS DISTINCT FROM new.active)) EXECUTE FUNCTION commerce.inventory_locations_refresh_alerts();


--
-- Name: inventory_locations inventory_locations_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_locations_guard BEFORE UPDATE OF active ON commerce.inventory_locations FOR EACH ROW EXECUTE FUNCTION commerce.inventory_locations_guard();


--
-- Name: inventory_movements inventory_movements_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_movements_guard BEFORE DELETE OR UPDATE ON commerce.inventory_movements FOR EACH ROW WHEN ((NOT commerce.sandbox_purging(old.store_id))) EXECUTE FUNCTION commerce.guard_inventory_movements();


--
-- Name: inventory_movements inventory_movements_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_movements_refuse_copied_order BEFORE INSERT ON commerce.inventory_movements FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: inventory_reservations inventory_reservations_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER inventory_reservations_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.inventory_reservations FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: invoice_settings invoice_settings_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER invoice_settings_rules BEFORE INSERT OR UPDATE ON commerce.invoice_settings FOR EACH ROW EXECUTE FUNCTION commerce.invoice_settings_rules();


--
-- Name: invoices invoices_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER invoices_append_only BEFORE DELETE OR UPDATE ON commerce.invoices FOR EACH ROW EXECUTE FUNCTION commerce.guard_document_change();


--
-- Name: invoices invoices_insert_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER invoices_insert_guard BEFORE INSERT ON commerce.invoices FOR EACH ROW EXECUTE FUNCTION commerce.document_insert_guard();


--
-- Name: invoices invoices_po_number; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER invoices_po_number BEFORE INSERT ON commerce.invoices FOR EACH ROW EXECUTE FUNCTION commerce.documents_po_number();


--
-- Name: invoices invoices_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER invoices_refuse_copied_order BEFORE INSERT ON commerce.invoices FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: kaizen_life_accounts kaizen_life_accounts_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER kaizen_life_accounts_fixed BEFORE UPDATE ON commerce.kaizen_life_accounts FOR EACH ROW EXECUTE FUNCTION commerce.kaizen_life_accounts_fixed();


--
-- Name: kaizen_life_handoffs kaizen_life_handoffs_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER kaizen_life_handoffs_fixed BEFORE UPDATE ON commerce.kaizen_life_handoffs FOR EACH ROW EXECUTE FUNCTION commerce.kaizen_life_handoffs_fixed();


--
-- Name: ledger_accounts ledger_accounts_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_accounts_rules BEFORE UPDATE ON commerce.ledger_accounts FOR EACH ROW EXECUTE FUNCTION commerce.ledger_accounts_rules();


--
-- Name: ledger_books ledger_books_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_books_rules BEFORE DELETE OR UPDATE ON commerce.ledger_books FOR EACH ROW EXECUTE FUNCTION commerce.ledger_books_rules();


--
-- Name: ledger_counters ledger_counters_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_counters_fixed BEFORE DELETE ON commerce.ledger_counters FOR EACH ROW EXECUTE FUNCTION commerce.ledger_fixed();


--
-- Name: ledger_counters ledger_counters_writer; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_counters_writer BEFORE INSERT OR UPDATE ON commerce.ledger_counters FOR EACH ROW EXECUTE FUNCTION commerce.ledger_writer();


--
-- Name: ledger_entries ledger_entries_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_entries_fixed BEFORE DELETE OR UPDATE ON commerce.ledger_entries FOR EACH ROW EXECUTE FUNCTION commerce.ledger_fixed();


--
-- Name: ledger_entries ledger_entries_writer; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_entries_writer BEFORE INSERT ON commerce.ledger_entries FOR EACH ROW EXECUTE FUNCTION commerce.ledger_writer();


--
-- Name: ledger_lines ledger_lines_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_lines_fixed BEFORE DELETE OR UPDATE ON commerce.ledger_lines FOR EACH ROW EXECUTE FUNCTION commerce.ledger_fixed();


--
-- Name: ledger_lines ledger_lines_writer; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_lines_writer BEFORE INSERT ON commerce.ledger_lines FOR EACH ROW EXECUTE FUNCTION commerce.ledger_writer();


--
-- Name: ledger_vouchers ledger_vouchers_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER ledger_vouchers_fixed BEFORE DELETE OR UPDATE ON commerce.ledger_vouchers FOR EACH ROW EXECUTE FUNCTION commerce.ledger_voucher_fixed();


--
-- Name: legal_snapshots legal_snapshots_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER legal_snapshots_append_only BEFORE DELETE OR UPDATE ON commerce.legal_snapshots FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: legal_source_reads legal_source_reads_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER legal_source_reads_fixed BEFORE UPDATE ON commerce.legal_source_reads FOR EACH ROW EXECUTE FUNCTION commerce.legal_sources_fixed();


--
-- Name: legal_source_texts legal_source_texts_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER legal_source_texts_fixed BEFORE UPDATE ON commerce.legal_source_texts FOR EACH ROW EXECUTE FUNCTION commerce.legal_sources_fixed();


--
-- Name: local_delivery_areas local_delivery_areas_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER local_delivery_areas_rules BEFORE INSERT OR UPDATE ON commerce.local_delivery_areas FOR EACH ROW EXECUTE FUNCTION commerce.local_delivery_areas_rules();


--
-- Name: look_versions look_versions_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER look_versions_fixed BEFORE UPDATE ON commerce.look_versions FOR EACH ROW EXECUTE FUNCTION commerce.look_versions_fixed();


--
-- Name: market_availability market_availability_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER market_availability_rules BEFORE INSERT OR UPDATE ON commerce.market_availability FOR EACH ROW EXECUTE FUNCTION commerce.market_availability_rules();


--
-- Name: market_price_rules market_price_rules_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER market_price_rules_rules BEFORE INSERT OR UPDATE ON commerce.market_price_rules FOR EACH ROW EXECUTE FUNCTION commerce.market_price_rules_rules();


--
-- Name: marketing_consent_events marketing_consent_events_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER marketing_consent_events_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.marketing_consent_events FOR EACH ROW EXECUTE FUNCTION commerce.marketing_consent_events_rules();


--
-- Name: marketing_subscribers marketing_subscribers_first_event; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER marketing_subscribers_first_event AFTER INSERT ON commerce.marketing_subscribers FOR EACH ROW EXECUTE FUNCTION commerce.marketing_subscribers_first_event();


--
-- Name: marketing_subscribers marketing_subscribers_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER marketing_subscribers_rules BEFORE INSERT OR UPDATE ON commerce.marketing_subscribers FOR EACH ROW EXECUTE FUNCTION commerce.marketing_subscribers_rules();


--
-- Name: menus menus_store_page_links; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER menus_store_page_links BEFORE INSERT OR UPDATE OF items, store_id ON commerce.menus FOR EACH ROW EXECUTE FUNCTION commerce.menus_store_page_links();


--
-- Name: oauth_grants oauth_grants_installation_ended; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER oauth_grants_installation_ended AFTER UPDATE OF revoked_at ON commerce.oauth_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((old.revoked_at IS NULL) AND (new.revoked_at IS NOT NULL) AND (new.resource = 'admin'::text))) EXECUTE FUNCTION commerce.app_installation_ended();


--
-- Name: order_discount_codes order_discount_codes_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_discount_codes_fixed BEFORE DELETE OR UPDATE ON commerce.order_discount_codes FOR EACH ROW EXECUTE FUNCTION commerce.order_discount_codes_fixed();


--
-- Name: order_downloads order_downloads_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_downloads_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.order_downloads FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: order_edit_lines order_edit_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_edit_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.order_edit_lines FOR EACH ROW EXECUTE FUNCTION commerce.order_edit_lines_rules();


--
-- Name: order_edits order_edits_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_edits_refuse_copied_order BEFORE INSERT ON commerce.order_edits FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: order_edits order_edits_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_edits_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.order_edits FOR EACH ROW EXECUTE FUNCTION commerce.order_edits_rules();


--
-- Name: order_edits order_edits_settled; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER order_edits_settled AFTER INSERT OR UPDATE ON commerce.order_edits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.status = 'applied'::text)) EXECUTE FUNCTION commerce.order_edits_settled();


--
-- Name: order_edits order_edits_unsent_closed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_edits_unsent_closed BEFORE INSERT ON commerce.order_edits FOR EACH ROW EXECUTE FUNCTION commerce.order_edits_unsent_closed();


--
-- Name: order_events order_events_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_events_append_only BEFORE DELETE OR UPDATE ON commerce.order_events FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: order_events order_events_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_events_refuse_copied_order BEFORE INSERT ON commerce.order_events FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order_event();


--
-- Name: order_line_components order_line_components_frozen; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_line_components_frozen BEFORE DELETE OR UPDATE ON commerce.order_line_components FOR EACH ROW EXECUTE FUNCTION commerce.order_line_components_frozen();


--
-- Name: order_lines order_lines_backorder_frozen; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_lines_backorder_frozen BEFORE UPDATE OF backorder_quantity, backorder_days ON commerce.order_lines FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_backorder_frozen();


--
-- Name: order_lines order_lines_copied_read_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_lines_copied_read_only BEFORE INSERT OR DELETE OR UPDATE ON commerce.order_lines FOR EACH ROW EXECUTE FUNCTION commerce.copied_order_lines_read_only();


--
-- Name: order_lines order_lines_exchange_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_lines_exchange_rules BEFORE INSERT ON commerce.order_lines FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_exchange_rules();


--
-- Name: order_lines order_lines_measure_frozen; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_lines_measure_frozen BEFORE UPDATE OF measure_amount, measure_unit, measure_base ON commerce.order_lines FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_measure_frozen();


--
-- Name: order_lines order_lines_settled_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_lines_settled_guard BEFORE INSERT OR DELETE OR UPDATE OF order_id, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, discount_minor, member_discount_minor, campaign_discount_minor, bonus_discount_minor, referral_discount_minor, staff_discount_minor, vat_relief_minor, variant_id, sku, delivery, order_edit_id ON commerce.order_lines FOR EACH ROW EXECUTE FUNCTION commerce.order_lines_settled_guard();


--
-- Name: order_payment_terms order_payment_terms_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_payment_terms_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.order_payment_terms FOR EACH ROW EXECUTE FUNCTION commerce.order_payment_terms_rules();


--
-- Name: order_payment_terms order_payment_terms_sold; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_payment_terms_sold AFTER INSERT OR UPDATE OF paid_at ON commerce.order_payment_terms FOR EACH ROW EXECUTE FUNCTION commerce.order_payment_terms_sold();


--
-- Name: order_rules order_rules_limit; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_rules_limit BEFORE INSERT OR UPDATE ON commerce.order_rules FOR EACH ROW EXECUTE FUNCTION commerce.order_rules_rules();


--
-- Name: order_tags order_tags_limit; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_tags_limit BEFORE INSERT ON commerce.order_tags FOR EACH ROW EXECUTE FUNCTION commerce.order_tags_limit();


--
-- Name: order_terms order_terms_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_terms_append_only BEFORE DELETE OR UPDATE ON commerce.order_terms FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: order_terms order_terms_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_terms_guard BEFORE INSERT ON commerce.order_terms FOR EACH ROW EXECUTE FUNCTION commerce.guard_order_terms();


--
-- Name: order_views order_views_limit; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER order_views_limit BEFORE INSERT ON commerce.order_views FOR EACH ROW EXECUTE FUNCTION commerce.order_views_limit();


--
-- Name: orders orders_ad_consent; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_ad_consent BEFORE INSERT OR UPDATE OF ad_consent_at, ad_signals ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_ad_consent();


--
-- Name: orders orders_affiliate; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_affiliate AFTER UPDATE OF status ON commerce.orders FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION commerce.orders_affiliate();


--
-- Name: orders orders_bonus; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_bonus AFTER UPDATE OF status ON commerce.orders FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION commerce.orders_bonus();


--
-- Name: orders orders_bookings_follow; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_bookings_follow AFTER UPDATE OF status ON commerce.orders FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION commerce.order_bookings_follow();


--
-- Name: orders orders_company_purchase; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_company_purchase BEFORE UPDATE OF po_number, company_location_id, approval ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_company_purchase();


--
-- Name: orders orders_copied_is_history; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_copied_is_history BEFORE INSERT ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.copied_order_is_history();


--
-- Name: orders orders_copied_read_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_copied_read_only BEFORE UPDATE ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.copied_orders_read_only();


--
-- Name: orders orders_creator; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_creator AFTER UPDATE OF status ON commerce.orders FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION commerce.orders_creator();


--
-- Name: orders orders_deal_win; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_deal_win AFTER UPDATE OF status ON commerce.orders FOR EACH ROW WHEN (((old.status <> ALL (ARRAY['paid'::commerce.order_status, 'fulfilled'::commerce.order_status, 'closed'::commerce.order_status])) AND (new.status = ANY (ARRAY['paid'::commerce.order_status, 'fulfilled'::commerce.order_status])))) EXECUTE FUNCTION commerce.orders_deal_win();


--
-- Name: orders orders_delivered_source; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_delivered_source BEFORE INSERT OR UPDATE OF delivered_at, delivered_source ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_delivered_source();


--
-- Name: orders orders_delivery_frozen; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_delivery_frozen BEFORE UPDATE OF delivery_method, delivery, pickup_location_id, ready_for_pickup_at ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_delivery_frozen();


--
-- Name: orders orders_dispute_evidence_forget; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_dispute_evidence_forget AFTER UPDATE OF anonymised_at ON commerce.orders FOR EACH ROW WHEN (((old.anonymised_at IS NULL) AND (new.anonymised_at IS NOT NULL))) EXECUTE FUNCTION commerce.dispute_evidence_forget();


--
-- Name: orders orders_draft_follow; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_draft_follow AFTER UPDATE OF status ON commerce.orders FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION commerce.orders_draft_follow();


--
-- Name: orders orders_exchange_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_exchange_rules BEFORE INSERT OR UPDATE OF exchange_id ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_exchange_rules();


--
-- Name: orders orders_forget_field_values; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_forget_field_values AFTER DELETE ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('order');


--
-- Name: orders orders_gift_card_payments; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_gift_card_payments AFTER UPDATE OF status ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_gift_card_payments();


--
-- Name: orders orders_gift_card_people; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_gift_card_people AFTER UPDATE OF anonymised_at ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_gift_card_people();


--
-- Name: orders orders_gift_frozen; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_gift_frozen BEFORE UPDATE OF is_gift, gift_to, gift_from, gift_message ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_gift_frozen();


--
-- Name: orders orders_issue_gift_cards; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER orders_issue_gift_cards AFTER UPDATE OF status ON commerce.orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.orders_issue_gift_cards();


--
-- Name: orders orders_number_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_number_guard BEFORE DELETE OR UPDATE OF number, store_id ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.order_number_guard();


--
-- Name: orders orders_origin_frozen; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_origin_frozen BEFORE UPDATE OF source, draft_id, made_by, staff_discount_minor, staff_discount_label ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_origin_frozen();


--
-- Name: orders orders_settled_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_settled_guard BEFORE UPDATE OF subtotal_minor, shipping_minor, discount_minor, member_discount_minor, campaign_discount_minor, credit_minor, referral_discount_minor, staff_discount_minor, tax_minor, total_minor, edited_at ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_settled_guard();


--
-- Name: orders orders_store_open; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_store_open BEFORE INSERT ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_store_open();


--
-- Name: orders orders_vat_frozen; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER orders_vat_frozen BEFORE UPDATE OF vat_kind, vat_relief_minor, vat_treatment, shipping_tax_rate, vat_check_id ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.orders_vat_frozen();


--
-- Name: page_redirects page_redirects_not_taken; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER page_redirects_not_taken BEFORE INSERT OR UPDATE ON commerce.page_redirects FOR EACH ROW EXECUTE FUNCTION commerce.page_redirects_not_taken();


--
-- Name: page_roles page_roles_experiment_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER page_roles_experiment_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.page_roles FOR EACH ROW EXECUTE FUNCTION commerce.page_roles_experiment_guard();


--
-- Name: page_schedules page_schedules_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER page_schedules_rules BEFORE UPDATE ON commerce.page_schedules FOR EACH ROW EXECUTE FUNCTION commerce.page_schedules_rules();


--
-- Name: page_theme_detaches page_theme_detaches_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER page_theme_detaches_rules BEFORE UPDATE ON commerce.page_theme_detaches FOR EACH ROW EXECUTE FUNCTION commerce.page_theme_detaches_rules();


--
-- Name: page_versions page_versions_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER page_versions_fixed BEFORE UPDATE ON commerce.page_versions FOR EACH ROW EXECUTE FUNCTION commerce.page_versions_fixed();


--
-- Name: pages pages_experiment_published_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER pages_experiment_published_guard BEFORE UPDATE OF published_at ON commerce.pages FOR EACH ROW EXECUTE FUNCTION commerce.pages_experiment_published_guard();


--
-- Name: pages pages_experiment_type_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER pages_experiment_type_guard BEFORE UPDATE OF type ON commerce.pages FOR EACH ROW EXECUTE FUNCTION commerce.pages_experiment_type_guard();


--
-- Name: pages pages_forget_field_values; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER pages_forget_field_values AFTER DELETE ON commerce.pages FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('page,article');


--
-- Name: pages pages_keep_addresses; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER pages_keep_addresses AFTER INSERT OR UPDATE OF slug ON commerce.pages FOR EACH ROW EXECUTE FUNCTION commerce.pages_keep_addresses();


--
-- Name: payment_disputes payment_disputes_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payment_disputes_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.payment_disputes FOR EACH ROW EXECUTE FUNCTION commerce.payment_disputes_rules();


--
-- Name: payment_providers payment_providers_sandbox; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payment_providers_sandbox BEFORE INSERT OR UPDATE OF store_id ON commerce.payment_providers FOR EACH ROW EXECUTE FUNCTION commerce.sandbox_doors();


--
-- Name: payments payments_creator_insert; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_creator_insert AFTER INSERT ON commerce.payments FOR EACH ROW WHEN ((new.status = 'captured'::commerce.payment_status)) EXECUTE FUNCTION commerce.payments_creator();


--
-- Name: payments payments_creator_status; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_creator_status AFTER UPDATE OF status ON commerce.payments FOR EACH ROW WHEN (((new.status = 'captured'::commerce.payment_status) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION commerce.payments_creator();


--
-- Name: payments payments_exchange_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_exchange_rules BEFORE INSERT OR UPDATE ON commerce.payments FOR EACH ROW EXECUTE FUNCTION commerce.payments_exchange_rules();


--
-- Name: payments payments_fee_once; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_fee_once BEFORE UPDATE OF provider_fee_minor, application_fee_minor, fee_currency ON commerce.payments FOR EACH ROW EXECUTE FUNCTION commerce.payments_fee_once();


--
-- Name: payments payments_gift_card; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_gift_card AFTER INSERT OR UPDATE ON commerce.payments FOR EACH ROW EXECUTE FUNCTION commerce.payments_gift_card();


--
-- Name: payments payments_issue_gift_cards; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER payments_issue_gift_cards AFTER INSERT OR UPDATE OF status ON commerce.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.payments_issue_gift_cards();


--
-- Name: payments payments_order_edit_ref; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_order_edit_ref BEFORE INSERT OR UPDATE OF order_edit_id ON commerce.payments FOR EACH ROW EXECUTE FUNCTION commerce.order_edit_money_ref();


--
-- Name: payments payments_referral_insert; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_referral_insert AFTER INSERT ON commerce.payments FOR EACH ROW WHEN ((new.status = 'captured'::commerce.payment_status)) EXECUTE FUNCTION commerce.payments_referral();


--
-- Name: payments payments_referral_status; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_referral_status AFTER UPDATE OF status ON commerce.payments FOR EACH ROW WHEN (((new.status = 'captured'::commerce.payment_status) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION commerce.payments_referral();


--
-- Name: payments payments_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.payments FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: payments payments_transfer_paired; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER payments_transfer_paired AFTER INSERT ON commerce.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.provider = 'exchange'::text)) EXECUTE FUNCTION commerce.exchange_transfers_paired();


--
-- Name: payments payments_venue_mode; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payments_venue_mode BEFORE INSERT ON commerce.payments FOR EACH ROW EXECUTE FUNCTION commerce.payments_venue_mode();


--
-- Name: payout_lines payout_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payout_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.payout_lines FOR EACH ROW EXECUTE FUNCTION commerce.payout_lines_rules();


--
-- Name: payouts payouts_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER payouts_rules BEFORE DELETE OR UPDATE ON commerce.payouts FOR EACH ROW EXECUTE FUNCTION commerce.payouts_rules();


--
-- Name: pickup_options pickup_options_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER pickup_options_rules BEFORE INSERT OR UPDATE ON commerce.pickup_options FOR EACH ROW EXECUTE FUNCTION commerce.pickup_options_rules();


--
-- Name: platform_page_roles platform_page_roles_page_check; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_page_roles_page_check BEFORE INSERT OR UPDATE OF page_id ON commerce.platform_page_roles FOR EACH ROW EXECUTE FUNCTION commerce.platform_page_role_is_kaizens_page();


--
-- Name: store_billing platform_plan_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_plan_events AFTER INSERT OR UPDATE OF status, plan_id, subscription_id, cancel_at_period_end ON commerce.store_billing FOR EACH ROW EXECUTE FUNCTION commerce.platform_plan_events();


--
-- Name: content_reports platform_report_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_report_events AFTER INSERT ON commerce.content_reports FOR EACH ROW EXECUTE FUNCTION commerce.platform_report_events();


--
-- Name: access_requests platform_request_erased; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_request_erased AFTER UPDATE OF email ON commerce.access_requests FOR EACH ROW WHEN (((new.email ~~ 'erased-%@erased.invalid'::text) AND (old.email IS DISTINCT FROM new.email))) EXECUTE FUNCTION commerce.platform_request_erased();


--
-- Name: access_requests platform_request_events; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_request_events AFTER INSERT ON commerce.access_requests FOR EACH ROW EXECUTE FUNCTION commerce.platform_request_events();


--
-- Name: platform_settings platform_settings_menus_are_kaizens; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_settings_menus_are_kaizens BEFORE INSERT OR UPDATE OF header_menu_id, footer_menu_id ON commerce.platform_settings FOR EACH ROW EXECUTE FUNCTION commerce.platform_menus_are_kaizens();


--
-- Name: platform_settings platform_settings_site_layout_is_type; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_settings_site_layout_is_type BEFORE INSERT OR UPDATE OF header_id, footer_id ON commerce.platform_settings FOR EACH ROW EXECUTE FUNCTION commerce.site_layout_is_type();


--
-- Name: platform_settings platform_site_from_store; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_site_from_store BEFORE INSERT OR UPDATE OF site_from_store ON commerce.platform_settings FOR EACH ROW EXECUTE FUNCTION commerce.platform_site_from_store();


--
-- Name: stores platform_store_created; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER platform_store_created AFTER INSERT ON commerce.stores DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.platform_store_created();


--
-- Name: stores platform_store_kept; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER platform_store_kept AFTER UPDATE OF sandbox ON commerce.stores DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((old.sandbox AND (NOT new.sandbox))) EXECUTE FUNCTION commerce.platform_store_created();


--
-- Name: stores platform_store_opened; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_store_opened AFTER UPDATE OF setup_completed_at ON commerce.stores FOR EACH ROW WHEN (((old.setup_completed_at IS NULL) AND (new.setup_completed_at IS NOT NULL))) EXECUTE FUNCTION commerce.platform_store_opened();


--
-- Name: platform_theme_install_updates platform_theme_install_updates_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_theme_install_updates_rules BEFORE UPDATE ON commerce.platform_theme_install_updates FOR EACH ROW EXECUTE FUNCTION commerce.platform_theme_install_updates_rules();


--
-- Name: platform_theme_installs platform_theme_installs_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER platform_theme_installs_rules BEFORE DELETE OR UPDATE ON commerce.platform_theme_installs FOR EACH ROW EXECUTE FUNCTION commerce.platform_theme_installs_rules();


--
-- Name: preview_links preview_links_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER preview_links_rules BEFORE INSERT OR UPDATE ON commerce.preview_links FOR EACH ROW EXECUTE FUNCTION commerce.preview_links_rules();


--
-- Name: price_breaks price_breaks_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER price_breaks_rules BEFORE INSERT OR UPDATE ON commerce.price_breaks FOR EACH ROW EXECUTE FUNCTION commerce.price_breaks_rules();


--
-- Name: price_list_breaks price_list_breaks_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER price_list_breaks_rules BEFORE INSERT OR UPDATE ON commerce.price_list_breaks FOR EACH ROW EXECUTE FUNCTION commerce.price_list_breaks_rules();


--
-- Name: prices prices_bundle_refresh; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER prices_bundle_refresh AFTER INSERT ON commerce.prices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.prices_bundle_refresh();


--
-- Name: prices prices_guard_history; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER prices_guard_history BEFORE DELETE OR UPDATE ON commerce.prices FOR EACH ROW WHEN ((NOT commerce.sandbox_purging(old.store_id))) EXECUTE FUNCTION commerce.guard_price_history();


--
-- Name: privacy_requests privacy_requests_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER privacy_requests_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.privacy_requests FOR EACH ROW EXECUTE FUNCTION commerce.privacy_requests_rules();


--
-- Name: product_reviews product_reviews_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER product_reviews_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.product_reviews FOR EACH ROW EXECUTE FUNCTION commerce.product_reviews_rules();


--
-- Name: product_terms product_terms_not_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER product_terms_not_rules BEFORE INSERT OR UPDATE OF term_id ON commerce.product_terms FOR EACH ROW EXECUTE FUNCTION commerce.product_terms_not_rules();


--
-- Name: product_terms product_terms_unit_price; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER product_terms_unit_price AFTER INSERT ON commerce.product_terms DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_unit_price();


--
-- Name: product_variants product_variants_alert_changed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER product_variants_alert_changed AFTER UPDATE OF low_stock_threshold ON commerce.product_variants FOR EACH ROW WHEN ((old.low_stock_threshold IS DISTINCT FROM new.low_stock_threshold)) EXECUTE FUNCTION commerce.product_variants_refresh_alert();


--
-- Name: product_variants product_variants_alert_created; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER product_variants_alert_created AFTER INSERT ON commerce.product_variants FOR EACH ROW WHEN ((new.low_stock_threshold IS NOT NULL)) EXECUTE FUNCTION commerce.product_variants_refresh_alert();


--
-- Name: product_variants product_variants_cost_keep; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER product_variants_cost_keep AFTER INSERT OR UPDATE OF cost_minor ON commerce.product_variants FOR EACH ROW EXECUTE FUNCTION commerce.variant_cost_keep();


--
-- Name: product_variants product_variants_gift_card; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER product_variants_gift_card AFTER INSERT OR UPDATE ON commerce.product_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_gift_card_product();


--
-- Name: product_variants product_variants_limit; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER product_variants_limit AFTER INSERT OR UPDATE OF active ON commerce.product_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.product_variants_limit();


--
-- Name: product_variants product_variants_unit_price; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER product_variants_unit_price AFTER INSERT OR UPDATE OF measure_amount, measure_unit, active, delivery ON commerce.product_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_unit_price();


--
-- Name: products products_bundle_on_request; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER products_bundle_on_request AFTER UPDATE OF bundle_pricing, price_on_request ON commerce.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.products_bundle_on_request();


--
-- Name: products products_bundle_refresh; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER products_bundle_refresh AFTER UPDATE OF bundle_pricing, bundle_percent_off ON commerce.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.products_bundle_refresh();


--
-- Name: products products_bundle_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER products_bundle_rules AFTER UPDATE OF vat_category, kind ON commerce.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.products_bundle_rules();


--
-- Name: products products_first_active; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_first_active BEFORE INSERT OR UPDATE ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.products_first_active();


--
-- Name: products products_forget_field_search; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_forget_field_search AFTER DELETE ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_search();


--
-- Name: products products_forget_field_values; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_forget_field_values AFTER DELETE ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('product');


--
-- Name: products products_gift_card; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER products_gift_card AFTER INSERT OR UPDATE ON commerce.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_gift_card_product();


--
-- Name: products products_host_vat; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_host_vat BEFORE INSERT OR UPDATE OF host_id, vat_category ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.products_host_vat();


--
-- Name: products products_leave_redirect; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_leave_redirect AFTER UPDATE OF handle ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.products_leave_redirect();


--
-- Name: products products_product_layout_is_layout; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_product_layout_is_layout BEFORE INSERT OR UPDATE OF product_layout_id ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.product_layout_is_layout();


--
-- Name: products products_publishable; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_publishable BEFORE INSERT OR UPDATE ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.assert_product_publishable();


--
-- Name: products products_taken_address; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER products_taken_address AFTER INSERT OR UPDATE OF handle ON commerce.products FOR EACH ROW EXECUTE FUNCTION commerce.products_taken_address();


--
-- Name: products products_unit_price; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER products_unit_price AFTER INSERT OR UPDATE OF status, sold_by_measure, kind ON commerce.products DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_unit_price();


--
-- Name: purchase_order_lines purchase_order_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER purchase_order_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION commerce.stock_document_lines_rules();


--
-- Name: purchase_orders purchase_orders_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER purchase_orders_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.purchase_orders FOR EACH ROW EXECUTE FUNCTION commerce.stock_documents_rules();


--
-- Name: redirects redirects_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER redirects_guard BEFORE INSERT OR UPDATE ON commerce.redirects FOR EACH ROW EXECUTE FUNCTION commerce.redirects_guard();


--
-- Name: redirects redirects_no_loop; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER redirects_no_loop BEFORE INSERT OR UPDATE OF source, target ON commerce.redirects FOR EACH ROW WHEN ((new.kind = 'manual'::text)) EXECUTE FUNCTION commerce.redirects_no_loop();


--
-- Name: referral_allocations referral_allocations_immutable; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER referral_allocations_immutable BEFORE DELETE OR UPDATE ON commerce.referral_allocations FOR EACH ROW EXECUTE FUNCTION commerce.referral_ledger_immutable();


--
-- Name: referral_allocations referral_allocations_within_lot; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER referral_allocations_within_lot AFTER INSERT ON commerce.referral_allocations FOR EACH ROW EXECUTE FUNCTION commerce.referral_allocation_within_lot();


--
-- Name: referral_entries referral_entries_fully_allocated; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER referral_entries_fully_allocated AFTER INSERT ON commerce.referral_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.referral_entry_fully_allocated();


--
-- Name: referral_entries referral_entries_immutable; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER referral_entries_immutable BEFORE DELETE OR UPDATE ON commerce.referral_entries FOR EACH ROW EXECUTE FUNCTION commerce.referral_ledger_immutable();


--
-- Name: refunds refunds_affiliate; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_affiliate AFTER INSERT ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_affiliate();


--
-- Name: refunds refunds_bonus; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_bonus AFTER INSERT ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_bonus();


--
-- Name: refunds refunds_creator; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_creator AFTER INSERT ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_creator();


--
-- Name: refunds refunds_credit_note; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER refunds_credit_note AFTER INSERT OR UPDATE OF status ON commerce.refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.status = 'succeeded'::commerce.refund_status)) EXECUTE FUNCTION commerce.refunds_issue_credit_note();


--
-- Name: refunds refunds_exchange_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_exchange_rules BEFORE INSERT OR UPDATE ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_exchange_rules();


--
-- Name: refunds refunds_gift_card; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_gift_card AFTER INSERT OR UPDATE OF status ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_gift_card();


--
-- Name: refunds refunds_manual_cap; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_manual_cap BEFORE INSERT OR UPDATE OF amount_minor, status, payment_id ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_manual_cap();


--
-- Name: refunds refunds_order_edit_ref; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_order_edit_ref BEFORE INSERT OR UPDATE OF order_edit_id ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.order_edit_money_ref();


--
-- Name: refunds refunds_referral; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_referral AFTER INSERT ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_referral();


--
-- Name: refunds refunds_succeeded_final; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER refunds_succeeded_final BEFORE UPDATE OF status ON commerce.refunds FOR EACH ROW EXECUTE FUNCTION commerce.refunds_succeeded_final();


--
-- Name: refunds refunds_transfer_paired; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER refunds_transfer_paired AFTER INSERT ON commerce.refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.kind = 'transfer'::text)) EXECUTE FUNCTION commerce.exchange_transfers_paired();


--
-- Name: retention_rules retention_rules_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER retention_rules_guard BEFORE DELETE OR UPDATE ON commerce.retention_rules FOR EACH ROW EXECUTE FUNCTION commerce.retention_rules_guard();


--
-- Name: return_exchange_lines return_exchange_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER return_exchange_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.return_exchange_lines FOR EACH ROW EXECUTE FUNCTION commerce.return_exchange_lines_rules();


--
-- Name: return_exchanges return_exchanges_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER return_exchanges_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.return_exchanges FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: return_exchanges return_exchanges_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER return_exchanges_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.return_exchanges FOR EACH ROW EXECUTE FUNCTION commerce.return_exchanges_rules();


--
-- Name: return_exchanges return_exchanges_settled; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER return_exchanges_settled AFTER INSERT OR UPDATE ON commerce.return_exchanges DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.return_exchanges_settled();


--
-- Name: return_lines return_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER return_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.return_lines FOR EACH ROW EXECUTE FUNCTION commerce.return_lines_rules();


--
-- Name: returns returns_credit_note; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER returns_credit_note AFTER INSERT OR UPDATE OF refund_minor, refund_outside, refund_working ON commerce.returns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.refund_outside AND (new.refund_id IS NULL) AND (new.refund_minor > 0))) EXECUTE FUNCTION commerce.returns_issue_credit_note();


--
-- Name: returns returns_exchange_credit_note; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER returns_exchange_credit_note AFTER UPDATE OF outcome ON commerce.returns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.outcome = 'exchanged'::text) AND (old.outcome IS DISTINCT FROM 'exchanged'::text))) EXECUTE FUNCTION commerce.returns_issue_credit_note();


--
-- Name: returns returns_label_pasted; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER returns_label_pasted BEFORE INSERT OR UPDATE OF label_url, label_source ON commerce.returns FOR EACH ROW EXECUTE FUNCTION commerce.returns_label_pasted();


--
-- Name: returns returns_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER returns_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.returns FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: returns returns_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER returns_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.returns FOR EACH ROW EXECUTE FUNCTION commerce.returns_rules();


--
-- Name: returns returns_working_once; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER returns_working_once BEFORE UPDATE OF refund_working ON commerce.returns FOR EACH ROW EXECUTE FUNCTION commerce.returns_working_once();


--
-- Name: review_pictures review_pictures_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER review_pictures_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.review_pictures FOR EACH ROW EXECUTE FUNCTION commerce.review_pictures_rules();


--
-- Name: sandboxes sandboxes_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER sandboxes_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.sandboxes FOR EACH ROW EXECUTE FUNCTION commerce.sandboxes_rules();


--
-- Name: search_rules search_rules_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER search_rules_rules BEFORE INSERT ON commerce.search_rules FOR EACH ROW EXECUTE FUNCTION commerce.search_rules_rules();


--
-- Name: search_synonyms search_synonyms_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER search_synonyms_rules BEFORE INSERT ON commerce.search_synonyms FOR EACH ROW EXECUTE FUNCTION commerce.search_synonyms_rules();


--
-- Name: segments segments_limit; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER segments_limit BEFORE INSERT ON commerce.segments FOR EACH ROW EXECUTE FUNCTION commerce.segments_limit();


--
-- Name: shipment_lines shipment_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipment_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.shipment_lines FOR EACH ROW EXECUTE FUNCTION commerce.shipment_lines_rules();


--
-- Name: shipments shipments_edit_pending; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipments_edit_pending BEFORE INSERT ON commerce.shipments FOR EACH ROW EXECUTE FUNCTION commerce.shipments_edit_pending();


--
-- Name: shipments shipments_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipments_guard BEFORE DELETE OR UPDATE ON commerce.shipments FOR EACH ROW EXECUTE FUNCTION commerce.shipments_guard();


--
-- Name: shipments shipments_have_lines; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER shipments_have_lines AFTER INSERT ON commerce.shipments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.shipment_has_lines();


--
-- Name: shipments shipments_method_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipments_method_rules BEFORE INSERT ON commerce.shipments FOR EACH ROW EXECUTE FUNCTION commerce.shipments_method_rules();


--
-- Name: shipments shipments_not_held; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipments_not_held BEFORE INSERT ON commerce.shipments FOR EACH ROW EXECUTE FUNCTION commerce.shipments_not_held();


--
-- Name: shipments shipments_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipments_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.shipments FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: shipping_methods shipping_methods_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipping_methods_rules BEFORE INSERT OR UPDATE ON commerce.shipping_methods FOR EACH ROW EXECUTE FUNCTION commerce.shipping_methods_rules();


--
-- Name: shipping_profiles shipping_profiles_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipping_profiles_rules BEFORE INSERT OR UPDATE ON commerce.shipping_profiles FOR EACH ROW EXECUTE FUNCTION commerce.shipping_profiles_rules();


--
-- Name: shipping_method_rates shipping_rates_tiers; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE CONSTRAINT TRIGGER shipping_rates_tiers AFTER INSERT OR DELETE OR UPDATE ON commerce.shipping_method_rates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.shipping_rates_tiers();


--
-- Name: shipping_zones shipping_zones_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER shipping_zones_rules BEFORE INSERT OR UPDATE ON commerce.shipping_zones FOR EACH ROW EXECUTE FUNCTION commerce.shipping_zones_rules();


--
-- Name: sms_consent_events sms_consent_events_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER sms_consent_events_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.sms_consent_events FOR EACH ROW EXECUTE FUNCTION commerce.sms_consent_events_rules();


--
-- Name: sms_messages sms_messages_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER sms_messages_rules BEFORE INSERT OR UPDATE ON commerce.sms_messages FOR EACH ROW EXECUTE FUNCTION commerce.sms_messages_rules();


--
-- Name: sms_subscribers sms_subscribers_first_event; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER sms_subscribers_first_event AFTER INSERT ON commerce.sms_subscribers FOR EACH ROW EXECUTE FUNCTION commerce.sms_subscribers_first_event();


--
-- Name: sms_subscribers sms_subscribers_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER sms_subscribers_rules BEFORE INSERT OR UPDATE ON commerce.sms_subscribers FOR EACH ROW EXECUTE FUNCTION commerce.sms_subscribers_rules();


--
-- Name: standing_deliveries standing_deliveries_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER standing_deliveries_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.standing_deliveries FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: stock_requests stock_requests_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stock_requests_rules BEFORE INSERT OR UPDATE ON commerce.stock_requests FOR EACH ROW EXECUTE FUNCTION commerce.stock_requests_rules();


--
-- Name: stock_transfer_lines stock_transfer_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stock_transfer_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.stock_transfer_lines FOR EACH ROW EXECUTE FUNCTION commerce.stock_document_lines_rules();


--
-- Name: stock_transfers stock_transfers_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stock_transfers_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.stock_transfers FOR EACH ROW EXECUTE FUNCTION commerce.stock_documents_rules();


--
-- Name: store_billing store_billing_house; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_billing_house BEFORE INSERT OR UPDATE ON commerce.store_billing FOR EACH ROW EXECUTE FUNCTION commerce.store_billing_house();


--
-- Name: store_billing store_billing_plan_moves; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_billing_plan_moves AFTER INSERT OR UPDATE OF status, price_id ON commerce.store_billing FOR EACH ROW EXECUTE FUNCTION commerce.plan_moves_track();


--
-- Name: store_domains store_domains_one_kind; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_domains_one_kind BEFORE INSERT OR UPDATE OF language, market ON commerce.store_domains FOR EACH ROW EXECUTE FUNCTION commerce.store_domains_one_kind();


--
-- Name: store_domains store_domains_sandbox; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_domains_sandbox BEFORE INSERT OR UPDATE OF store_id ON commerce.store_domains FOR EACH ROW EXECUTE FUNCTION commerce.sandbox_doors();


--
-- Name: orders store_event_order_paid; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_event_order_paid AFTER INSERT OR UPDATE OF status ON commerce.orders FOR EACH ROW EXECUTE FUNCTION commerce.store_event_order_paid();


--
-- Name: returns store_event_return_requested; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_event_return_requested AFTER INSERT ON commerce.returns FOR EACH ROW EXECUTE FUNCTION commerce.store_event_return_requested();


--
-- Name: store_locations store_locations_shipping_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_locations_shipping_rules BEFORE UPDATE OF kind, country, latitude, longitude ON commerce.store_locations FOR EACH ROW EXECUTE FUNCTION commerce.store_locations_shipping_rules();


--
-- Name: store_members store_members_house; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_members_house BEFORE INSERT OR UPDATE OF store_id, account_id, disabled_at ON commerce.store_members FOR EACH ROW EXECUTE FUNCTION commerce.store_members_house();


--
-- Name: store_members store_members_keep_an_owner; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_members_keep_an_owner BEFORE DELETE OR UPDATE ON commerce.store_members FOR EACH ROW WHEN ((NOT commerce.sandbox_purging(old.store_id))) EXECUTE FUNCTION commerce.keep_an_owner();


--
-- Name: store_members store_members_left_apps; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_members_left_apps AFTER DELETE ON commerce.store_members FOR EACH ROW EXECUTE FUNCTION commerce.store_member_left_apps();


--
-- Name: store_members store_members_sandbox; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_members_sandbox BEFORE INSERT OR UPDATE OF store_id, account_id ON commerce.store_members FOR EACH ROW EXECUTE FUNCTION commerce.store_members_sandbox();


--
-- Name: store_starters store_starters_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_starters_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.store_starters FOR EACH ROW EXECUTE FUNCTION commerce.store_starters_rules();


--
-- Name: store_tax_profile store_tax_profile_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_tax_profile_rules BEFORE INSERT OR UPDATE ON commerce.store_tax_profile FOR EACH ROW EXECUTE FUNCTION commerce.store_tax_profile_rules();


--
-- Name: store_theme_installs store_theme_installs_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER store_theme_installs_rules BEFORE DELETE OR UPDATE ON commerce.store_theme_installs FOR EACH ROW WHEN ((NOT commerce.sandbox_purging(old.store_id))) EXECUTE FUNCTION commerce.store_theme_installs_rules();


--
-- Name: stores stores_experiment_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_experiment_guard BEFORE UPDATE OF header_id, footer_id, front_page_id, products_page_id ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_experiment_guard();


--
-- Name: stores stores_features_after; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_features_after AFTER UPDATE OF features ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_features_after();


--
-- Name: stores stores_features_sync; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_features_sync BEFORE INSERT OR UPDATE OF features, modules ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_features_sync();


--
-- Name: stores stores_first_blog; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_first_blog AFTER INSERT ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_first_blog();


--
-- Name: stores stores_first_install; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_first_install AFTER INSERT ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_first_install();


--
-- Name: stores stores_front_page_is_page; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_front_page_is_page BEFORE INSERT OR UPDATE OF front_page_id ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_front_page_is_page();


--
-- Name: stores stores_house_public; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_house_public BEFORE UPDATE OF private_mode ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_house_public();


--
-- Name: stores stores_house_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_house_rules BEFORE INSERT OR UPDATE OF house, status ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_house_rules();


--
-- Name: stores stores_initialise; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_initialise AFTER INSERT ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.initialise_store();


--
-- Name: stores stores_open_theme_purchases; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_open_theme_purchases AFTER UPDATE OF setup_completed_at ON commerce.stores FOR EACH ROW WHEN (((old.setup_completed_at IS NULL) AND (new.setup_completed_at IS NOT NULL))) EXECUTE FUNCTION commerce.stores_open_theme_purchases();


--
-- Name: stores stores_product_layout_is_layout; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_product_layout_is_layout BEFORE INSERT OR UPDATE OF product_layout_id ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.product_layout_is_layout();


--
-- Name: stores stores_sandbox_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_sandbox_rules BEFORE INSERT OR UPDATE OF sandbox, private_mode, shopping_agents, domain_buying, slug ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_sandbox_rules();


--
-- Name: stores stores_site_layout_is_type; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_site_layout_is_type BEFORE INSERT OR UPDATE OF header_id, footer_id ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.site_layout_is_type();


--
-- Name: stores stores_starter_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_starter_rules BEFORE INSERT OR UPDATE OF starter ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_starter_rules();


--
-- Name: stores stores_status_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER stores_status_rules BEFORE UPDATE OF status ON commerce.stores FOR EACH ROW EXECUTE FUNCTION commerce.stores_status_rules();


--
-- Name: supplier_invoices supplier_invoices_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER supplier_invoices_fixed BEFORE DELETE OR UPDATE ON commerce.supplier_invoices FOR EACH ROW EXECUTE FUNCTION commerce.supplier_invoice_fixed();


--
-- Name: support_actions support_actions_store; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_actions_store BEFORE INSERT OR UPDATE OF conversation_id, store_id ON commerce.support_actions FOR EACH ROW EXECUTE FUNCTION commerce.support_actions_store();


--
-- Name: support_agents support_agents_touch; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_agents_touch BEFORE UPDATE ON commerce.support_agents FOR EACH ROW EXECUTE FUNCTION commerce.support_touch();


--
-- Name: support_conversations support_conversations_desk_mode; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_conversations_desk_mode BEFORE INSERT OR UPDATE OF desk_mode ON commerce.support_conversations FOR EACH ROW EXECUTE FUNCTION commerce.support_conversations_desk_mode();


--
-- Name: support_conversations support_conversations_ping; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_conversations_ping AFTER UPDATE OF handler, status, assignee_id, tone_alert_at ON commerce.support_conversations FOR EACH ROW WHEN (((((old.handler IS DISTINCT FROM new.handler) OR (old.status IS DISTINCT FROM new.status)) OR (old.assignee_id IS DISTINCT FROM new.assignee_id)) OR (old.tone_alert_at IS DISTINCT FROM new.tone_alert_at))) EXECUTE FUNCTION commerce.support_ping_state();


--
-- Name: support_conversations support_conversations_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_conversations_rules BEFORE INSERT OR UPDATE ON commerce.support_conversations FOR EACH ROW EXECUTE FUNCTION commerce.support_conversations_rules();


--
-- Name: support_messages support_messages_ping; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_messages_ping AFTER INSERT ON commerce.support_messages FOR EACH ROW EXECUTE FUNCTION commerce.support_ping_message();


--
-- Name: support_messages support_messages_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_messages_rules BEFORE INSERT OR UPDATE ON commerce.support_messages FOR EACH ROW EXECUTE FUNCTION commerce.support_messages_rules();


--
-- Name: support_replies support_replies_touch; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_replies_touch BEFORE UPDATE ON commerce.support_replies FOR EACH ROW EXECUTE FUNCTION commerce.support_touch();


--
-- Name: support_settings support_settings_touch; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER support_settings_touch BEFORE UPDATE ON commerce.support_settings FOR EACH ROW EXECUTE FUNCTION commerce.support_touch();


--
-- Name: tax_rate_overrides tax_rate_overrides_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER tax_rate_overrides_rules BEFORE INSERT OR UPDATE ON commerce.tax_rate_overrides FOR EACH ROW EXECUTE FUNCTION commerce.tax_rate_overrides_rules();


--
-- Name: tax_report_exports tax_report_exports_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER tax_report_exports_append_only BEFORE DELETE OR UPDATE ON commerce.tax_report_exports FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: terms terms_forget_field_values; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER terms_forget_field_values AFTER DELETE ON commerce.terms FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('term');


--
-- Name: terms terms_leave_redirect; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER terms_leave_redirect AFTER UPDATE OF slug ON commerce.terms FOR EACH ROW EXECUTE FUNCTION commerce.terms_leave_redirect();


--
-- Name: terms terms_parent_valid; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER terms_parent_valid BEFORE INSERT OR UPDATE OF parent_id, store_id, content_type, kind ON commerce.terms FOR EACH ROW EXECUTE FUNCTION commerce.terms_parent_valid();


--
-- Name: terms terms_product_layout_is_layout; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER terms_product_layout_is_layout BEFORE INSERT OR UPDATE OF product_layout_id ON commerce.terms FOR EACH ROW EXECUTE FUNCTION commerce.product_layout_is_layout();


--
-- Name: terms terms_rules_without_members; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER terms_rules_without_members BEFORE INSERT OR UPDATE OF rules ON commerce.terms FOR EACH ROW WHEN ((new.rules IS NOT NULL)) EXECUTE FUNCTION commerce.terms_rules_without_members();


--
-- Name: terms terms_taken_address; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER terms_taken_address AFTER INSERT OR UPDATE OF slug ON commerce.terms FOR EACH ROW EXECUTE FUNCTION commerce.terms_taken_address();


--
-- Name: theme_install_updates theme_install_updates_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER theme_install_updates_rules BEFORE UPDATE ON commerce.theme_install_updates FOR EACH ROW EXECUTE FUNCTION commerce.theme_install_updates_rules();


--
-- Name: store_theme_installs theme_installs_charge; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER theme_installs_charge AFTER INSERT OR UPDATE OF live ON commerce.store_theme_installs FOR EACH ROW EXECUTE FUNCTION commerce.theme_installs_charge();


--
-- Name: theme_prices theme_prices_author_free; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER theme_prices_author_free BEFORE INSERT OR UPDATE ON commerce.theme_prices FOR EACH ROW EXECUTE FUNCTION commerce.theme_prices_author_free();


--
-- Name: theme_purchases theme_purchases_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER theme_purchases_rules BEFORE DELETE OR UPDATE ON commerce.theme_purchases FOR EACH ROW EXECUTE FUNCTION commerce.theme_purchases_rules();


--
-- Name: theme_schedules theme_schedules_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER theme_schedules_rules BEFORE INSERT OR UPDATE ON commerce.theme_schedules FOR EACH ROW EXECUTE FUNCTION commerce.theme_schedules_rules();


--
-- Name: theme_submissions theme_submissions_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER theme_submissions_rules BEFORE INSERT OR UPDATE ON commerce.theme_submissions FOR EACH ROW EXECUTE FUNCTION commerce.theme_submissions_rules();


--
-- Name: unsent_closures unsent_closures_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER unsent_closures_guard BEFORE DELETE OR UPDATE ON commerce.unsent_closures FOR EACH ROW EXECUTE FUNCTION commerce.guard_unsent_closures();


--
-- Name: unsent_closures unsent_closures_refresh; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER unsent_closures_refresh AFTER INSERT ON commerce.unsent_closures FOR EACH ROW EXECUTE FUNCTION commerce.unsent_closures_refresh();


--
-- Name: unsent_closures unsent_closures_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER unsent_closures_rules BEFORE INSERT ON commerce.unsent_closures FOR EACH ROW EXECUTE FUNCTION commerce.unsent_closures_rules();


--
-- Name: variant_cost_history variant_cost_history_fixed; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER variant_cost_history_fixed BEFORE DELETE OR UPDATE ON commerce.variant_cost_history FOR EACH ROW EXECUTE FUNCTION commerce.variant_cost_history_fixed();


--
-- Name: product_variants variants_forget_field_values; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER variants_forget_field_values AFTER DELETE ON commerce.product_variants FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('variant');


--
-- Name: vat_categories vat_categories_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER vat_categories_rules BEFORE DELETE OR UPDATE ON commerce.vat_categories FOR EACH ROW EXECUTE FUNCTION commerce.vat_categories_rules();


--
-- Name: vat_checks vat_checks_immutable; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER vat_checks_immutable BEFORE UPDATE ON commerce.vat_checks FOR EACH ROW EXECUTE FUNCTION commerce.vat_checks_immutable();


--
-- Name: vat_rates vat_rates_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER vat_rates_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.vat_rates FOR EACH ROW EXECUTE FUNCTION commerce.vat_rates_rules();


--
-- Name: withdrawal_request_lines withdrawal_request_lines_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER withdrawal_request_lines_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.withdrawal_request_lines FOR EACH ROW EXECUTE FUNCTION commerce.withdrawal_request_lines_rules();


--
-- Name: withdrawal_requests withdrawal_requests_refuse_copied_order; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER withdrawal_requests_refuse_copied_order BEFORE INSERT OR UPDATE OF order_id ON commerce.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION commerce.refuse_copied_order();


--
-- Name: withdrawal_requests withdrawal_requests_rules; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER withdrawal_requests_rules BEFORE INSERT OR DELETE OR UPDATE ON commerce.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION commerce.withdrawal_requests_rules();


--
-- Name: work_credit_notes work_credit_notes_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_credit_notes_append_only BEFORE DELETE OR UPDATE ON commerce.work_credit_notes FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: work_credit_notes work_credit_notes_applied; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_credit_notes_applied AFTER INSERT ON commerce.work_credit_notes FOR EACH ROW EXECUTE FUNCTION commerce.work_credit_note_applied();


--
-- Name: work_credit_notes work_credit_notes_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_credit_notes_guard BEFORE INSERT ON commerce.work_credit_notes FOR EACH ROW EXECUTE FUNCTION commerce.work_credit_note_guard();


--
-- Name: work_events work_events_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_events_append_only BEFORE DELETE OR UPDATE ON commerce.work_events FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: work_invoice_lines work_invoice_lines_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoice_lines_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.work_invoice_lines FOR EACH ROW EXECUTE FUNCTION commerce.work_line_guard();


--
-- Name: work_invoice_losses work_invoice_losses_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoice_losses_append_only BEFORE DELETE OR UPDATE ON commerce.work_invoice_losses FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: work_invoice_losses work_invoice_losses_applied; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoice_losses_applied AFTER INSERT ON commerce.work_invoice_losses FOR EACH ROW EXECUTE FUNCTION commerce.work_loss_applied();


--
-- Name: work_invoice_losses work_invoice_losses_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoice_losses_guard BEFORE INSERT ON commerce.work_invoice_losses FOR EACH ROW EXECUTE FUNCTION commerce.work_loss_guard();


--
-- Name: work_invoice_payments work_invoice_payments_append_only; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoice_payments_append_only BEFORE DELETE OR UPDATE ON commerce.work_invoice_payments FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();


--
-- Name: work_invoice_payments work_invoice_payments_applied; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoice_payments_applied AFTER INSERT ON commerce.work_invoice_payments FOR EACH ROW EXECUTE FUNCTION commerce.work_payment_applied();


--
-- Name: work_invoice_payments work_invoice_payments_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoice_payments_guard BEFORE INSERT ON commerce.work_invoice_payments FOR EACH ROW EXECUTE FUNCTION commerce.work_payment_guard();


--
-- Name: work_invoices work_invoices_deal_win; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoices_deal_win AFTER UPDATE OF status ON commerce.work_invoices FOR EACH ROW WHEN (((old.status = 'draft'::text) AND (new.status <> 'draft'::text) AND (new.assignment_id IS NOT NULL) AND (NOT new.imported))) EXECUTE FUNCTION commerce.work_invoices_deal_win();


--
-- Name: work_invoices work_invoices_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoices_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.work_invoices FOR EACH ROW EXECUTE FUNCTION commerce.work_invoice_guard();


--
-- Name: work_invoices work_invoices_skip_deleted_period; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_invoices_skip_deleted_period AFTER DELETE ON commerce.work_invoices FOR EACH ROW EXECUTE FUNCTION commerce.work_invoice_skip_deleted_period();


--
-- Name: work_time_entries work_time_entries_guard; Type: TRIGGER; Schema: commerce; Owner: -
--

CREATE TRIGGER work_time_entries_guard BEFORE INSERT OR DELETE OR UPDATE ON commerce.work_time_entries FOR EACH ROW EXECUTE FUNCTION commerce.work_entry_guard();


--
-- Name: abandoned_checkouts abandoned_checkouts_cart_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_checkouts
    ADD CONSTRAINT abandoned_checkouts_cart_fk FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts(store_id, id) ON DELETE CASCADE;


--
-- Name: abandoned_checkouts abandoned_checkouts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_checkouts
    ADD CONSTRAINT abandoned_checkouts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: abandoned_plan_checkouts abandoned_plan_checkouts_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_plan_checkouts
    ADD CONSTRAINT abandoned_plan_checkouts_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: abandoned_plan_checkouts abandoned_plan_checkouts_price_id_plan_prices_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_plan_checkouts
    ADD CONSTRAINT abandoned_plan_checkouts_price_id_plan_prices_id_fk FOREIGN KEY (price_id) REFERENCES commerce.plan_prices(id) ON DELETE SET NULL;


--
-- Name: abandoned_plan_checkouts abandoned_plan_checkouts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.abandoned_plan_checkouts
    ADD CONSTRAINT abandoned_plan_checkouts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: access_requests access_requests_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.access_requests
    ADD CONSTRAINT access_requests_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id);


--
-- Name: access_requests access_requests_design_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.access_requests
    ADD CONSTRAINT access_requests_design_preset_id_design_presets_id_fk FOREIGN KEY (design_preset_id) REFERENCES commerce.design_presets(id);


--
-- Name: access_requests access_requests_sandbox_id_sandboxes_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.access_requests
    ADD CONSTRAINT access_requests_sandbox_id_sandboxes_id_fk FOREIGN KEY (sandbox_id) REFERENCES commerce.sandboxes(id);


--
-- Name: access_requests access_requests_starter_id_store_starters_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.access_requests
    ADD CONSTRAINT access_requests_starter_id_store_starters_id_fk FOREIGN KEY (starter_id) REFERENCES commerce.store_starters(id);


--
-- Name: access_requests access_requests_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.access_requests
    ADD CONSTRAINT access_requests_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: accessibility_settings accessibility_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.accessibility_settings
    ADD CONSTRAINT accessibility_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: accessibility_settings accessibility_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.accessibility_settings
    ADD CONSTRAINT accessibility_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: account_recovery_codes account_recovery_codes_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.account_recovery_codes
    ADD CONSTRAINT account_recovery_codes_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: activities activities_assignee_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_assignee_id_accounts_id_fk FOREIGN KEY (assignee_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: activities activities_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_company_fk FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies(store_id, id) ON DELETE SET NULL (company_id);


--
-- Name: activities activities_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: activities activities_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (customer_id);


--
-- Name: activities activities_deal_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_deal_fk FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals(store_id, id) ON DELETE CASCADE;


--
-- Name: activities activities_done_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_done_by_accounts_id_fk FOREIGN KEY (done_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: activities activities_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.activities
    ADD CONSTRAINT activities_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ad_connections ad_connections_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_connections
    ADD CONSTRAINT ad_connections_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ad_conversions ad_conversions_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_conversions
    ADD CONSTRAINT ad_conversions_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE CASCADE;


--
-- Name: ad_conversions ad_conversions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ad_conversions
    ADD CONSTRAINT ad_conversions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: affiliate_attributions affiliate_attributions_affiliate_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_attributions
    ADD CONSTRAINT affiliate_attributions_affiliate_fk FOREIGN KEY (store_id, affiliate_customer_id) REFERENCES commerce.affiliates(store_id, customer_id) ON DELETE CASCADE;


--
-- Name: affiliate_attributions affiliate_attributions_friend_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_attributions
    ADD CONSTRAINT affiliate_attributions_friend_fk FOREIGN KEY (store_id, friend_customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (friend_customer_id);


--
-- Name: affiliate_attributions affiliate_attributions_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_attributions
    ADD CONSTRAINT affiliate_attributions_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE CASCADE;


--
-- Name: affiliate_attributions affiliate_attributions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_attributions
    ADD CONSTRAINT affiliate_attributions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: affiliate_settings affiliate_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_settings
    ADD CONSTRAINT affiliate_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: affiliate_settings affiliate_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliate_settings
    ADD CONSTRAINT affiliate_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: affiliates affiliates_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliates
    ADD CONSTRAINT affiliates_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: affiliates affiliates_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.affiliates
    ADD CONSTRAINT affiliates_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ai_eval_runs ai_eval_runs_ran_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_eval_runs
    ADD CONSTRAINT ai_eval_runs_ran_by_accounts_id_fk FOREIGN KEY (ran_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ai_model_prices ai_model_prices_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_model_prices
    ADD CONSTRAINT ai_model_prices_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: ai_providers ai_providers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_providers
    ADD CONSTRAINT ai_providers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: ai_providers ai_providers_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_providers
    ADD CONSTRAINT ai_providers_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: ai_usage ai_usage_actor_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_usage
    ADD CONSTRAINT ai_usage_actor_account_id_accounts_id_fk FOREIGN KEY (actor_account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ai_usage ai_usage_owner_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_usage
    ADD CONSTRAINT ai_usage_owner_account_id_accounts_id_fk FOREIGN KEY (owner_account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ai_usage ai_usage_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ai_usage
    ADD CONSTRAINT ai_usage_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE SET NULL;


--
-- Name: analytics_alert_sends analytics_alert_sends_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.analytics_alert_sends
    ADD CONSTRAINT analytics_alert_sends_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: analytics_settings analytics_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.analytics_settings
    ADD CONSTRAINT analytics_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: analytics_targets analytics_targets_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.analytics_targets
    ADD CONSTRAINT analytics_targets_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: api_app_idempotency_keys api_app_idempotency_keys_grant_id_oauth_grants_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_app_idempotency_keys
    ADD CONSTRAINT api_app_idempotency_keys_grant_id_oauth_grants_id_fk FOREIGN KEY (grant_id) REFERENCES commerce.oauth_grants(id) ON DELETE CASCADE;


--
-- Name: api_idempotency_keys api_idempotency_keys_token_id_api_tokens_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_idempotency_keys
    ADD CONSTRAINT api_idempotency_keys_token_id_api_tokens_id_fk FOREIGN KEY (token_id) REFERENCES commerce.api_tokens(id) ON DELETE CASCADE;


--
-- Name: api_tokens api_tokens_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_tokens
    ADD CONSTRAINT api_tokens_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: api_tokens api_tokens_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_tokens
    ADD CONSTRAINT api_tokens_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: api_uploads api_uploads_media_id_media_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_uploads
    ADD CONSTRAINT api_uploads_media_id_media_id_fk FOREIGN KEY (media_id) REFERENCES commerce.media(id) ON DELETE SET NULL;


--
-- Name: api_uploads api_uploads_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_uploads
    ADD CONSTRAINT api_uploads_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: api_uploads api_uploads_token_id_api_tokens_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.api_uploads
    ADD CONSTRAINT api_uploads_token_id_api_tokens_id_fk FOREIGN KEY (token_id) REFERENCES commerce.api_tokens(id) ON DELETE CASCADE;


--
-- Name: appointment_settings appointment_settings_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.appointment_settings
    ADD CONSTRAINT appointment_settings_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.store_locations(store_id, id);


--
-- Name: appointment_settings appointment_settings_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.appointment_settings
    ADD CONSTRAINT appointment_settings_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: apps apps_client_id_oauth_clients_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.apps
    ADD CONSTRAINT apps_client_id_oauth_clients_id_fk FOREIGN KEY (client_id) REFERENCES commerce.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: apps apps_developer_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.apps
    ADD CONSTRAINT apps_developer_id_accounts_id_fk FOREIGN KEY (developer_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: assistant_approvals assistant_approvals_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_approvals
    ADD CONSTRAINT assistant_approvals_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: assistant_approvals assistant_approvals_conversation_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_approvals
    ADD CONSTRAINT assistant_approvals_conversation_fk FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE CASCADE;


--
-- Name: assistant_approvals assistant_approvals_oauth_grant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_approvals
    ADD CONSTRAINT assistant_approvals_oauth_grant_fk FOREIGN KEY (oauth_grant_id) REFERENCES commerce.oauth_grants(id) ON DELETE SET NULL;


--
-- Name: assistant_approvals assistant_approvals_plan_step_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_approvals
    ADD CONSTRAINT assistant_approvals_plan_step_fk FOREIGN KEY (plan_step_id) REFERENCES commerce.assistant_plan_steps(id) ON DELETE SET NULL;


--
-- Name: assistant_approvals assistant_approvals_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_approvals
    ADD CONSTRAINT assistant_approvals_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_conversations assistant_conversations_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_conversations
    ADD CONSTRAINT assistant_conversations_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: assistant_conversations assistant_conversations_oauth_client_id_oauth_clients_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_conversations
    ADD CONSTRAINT assistant_conversations_oauth_client_id_oauth_clients_id_fk FOREIGN KEY (oauth_client_id) REFERENCES commerce.oauth_clients(id) ON DELETE SET NULL;


--
-- Name: assistant_conversations assistant_conversations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_conversations
    ADD CONSTRAINT assistant_conversations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_follow_ups assistant_follow_ups_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_follow_ups
    ADD CONSTRAINT assistant_follow_ups_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: assistant_follow_ups assistant_follow_ups_conversation_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_follow_ups
    ADD CONSTRAINT assistant_follow_ups_conversation_fk FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE CASCADE;


--
-- Name: assistant_follow_ups assistant_follow_ups_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_follow_ups
    ADD CONSTRAINT assistant_follow_ups_order_id_orders_id_fk FOREIGN KEY (order_id) REFERENCES commerce.orders(id) ON DELETE SET NULL;


--
-- Name: assistant_follow_ups assistant_follow_ups_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_follow_ups
    ADD CONSTRAINT assistant_follow_ups_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_goals assistant_goals_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_goals
    ADD CONSTRAINT assistant_goals_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: assistant_goals assistant_goals_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_goals
    ADD CONSTRAINT assistant_goals_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_memories assistant_memories_account_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_memories
    ADD CONSTRAINT assistant_memories_account_id_fkey FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: assistant_memories assistant_memories_store_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_memories
    ADD CONSTRAINT assistant_memories_store_id_fkey FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_messages assistant_messages_conversation_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_messages
    ADD CONSTRAINT assistant_messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE CASCADE;


--
-- Name: assistant_messages assistant_messages_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_messages
    ADD CONSTRAINT assistant_messages_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_notices assistant_notices_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_notices
    ADD CONSTRAINT assistant_notices_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: assistant_notices assistant_notices_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_notices
    ADD CONSTRAINT assistant_notices_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_plan_steps assistant_plan_steps_answered_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plan_steps
    ADD CONSTRAINT assistant_plan_steps_answered_by_accounts_id_fk FOREIGN KEY (answered_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: assistant_plan_steps assistant_plan_steps_plan_id_assistant_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plan_steps
    ADD CONSTRAINT assistant_plan_steps_plan_id_assistant_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.assistant_plans(id) ON DELETE CASCADE;


--
-- Name: assistant_plan_steps assistant_plan_steps_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plan_steps
    ADD CONSTRAINT assistant_plan_steps_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_plans assistant_plans_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plans
    ADD CONSTRAINT assistant_plans_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: assistant_plans assistant_plans_conversation_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plans
    ADD CONSTRAINT assistant_plans_conversation_fk FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE CASCADE;


--
-- Name: assistant_plans assistant_plans_goal_id_assistant_goals_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plans
    ADD CONSTRAINT assistant_plans_goal_id_assistant_goals_id_fk FOREIGN KEY (goal_id) REFERENCES commerce.assistant_goals(id) ON DELETE SET NULL;


--
-- Name: assistant_plans assistant_plans_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_plans
    ADD CONSTRAINT assistant_plans_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: assistant_skills assistant_skills_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_skills
    ADD CONSTRAINT assistant_skills_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: assistant_skills assistant_skills_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.assistant_skills
    ADD CONSTRAINT assistant_skills_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.audit_log
    ADD CONSTRAINT audit_log_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: audit_log audit_log_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.audit_log
    ADD CONSTRAINT audit_log_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: automation_sends automation_sends_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.automation_sends
    ADD CONSTRAINT automation_sends_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: automation_sends automation_sends_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.automation_sends
    ADD CONSTRAINT automation_sends_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: automation_sends automation_sends_subscriber_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.automation_sends
    ADD CONSTRAINT automation_sends_subscriber_fk FOREIGN KEY (store_id, subscriber_id) REFERENCES commerce.marketing_subscribers(store_id, id) ON DELETE CASCADE;


--
-- Name: automations automations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.automations
    ADD CONSTRAINT automations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: automations automations_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.automations
    ADD CONSTRAINT automations_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: autopilot_effects autopilot_effects_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_effects
    ADD CONSTRAINT autopilot_effects_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: autopilot_event_checks autopilot_event_checks_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_event_checks
    ADD CONSTRAINT autopilot_event_checks_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: autopilot_events autopilot_events_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_events
    ADD CONSTRAINT autopilot_events_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: autopilot_events autopilot_events_conversation_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_events
    ADD CONSTRAINT autopilot_events_conversation_fk FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE SET NULL;


--
-- Name: autopilot_events autopilot_events_plan_id_assistant_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_events
    ADD CONSTRAINT autopilot_events_plan_id_assistant_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.assistant_plans(id) ON DELETE SET NULL;


--
-- Name: autopilot_events autopilot_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_events
    ADD CONSTRAINT autopilot_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: autopilot_reports autopilot_reports_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reports
    ADD CONSTRAINT autopilot_reports_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: autopilot_reports autopilot_reports_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reports
    ADD CONSTRAINT autopilot_reports_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: autopilot_reviews autopilot_reviews_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reviews
    ADD CONSTRAINT autopilot_reviews_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: autopilot_reviews autopilot_reviews_conversation_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reviews
    ADD CONSTRAINT autopilot_reviews_conversation_fk FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE SET NULL;


--
-- Name: autopilot_reviews autopilot_reviews_goal_id_assistant_goals_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reviews
    ADD CONSTRAINT autopilot_reviews_goal_id_assistant_goals_id_fk FOREIGN KEY (goal_id) REFERENCES commerce.assistant_goals(id) ON DELETE CASCADE;


--
-- Name: autopilot_reviews autopilot_reviews_plan_id_assistant_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reviews
    ADD CONSTRAINT autopilot_reviews_plan_id_assistant_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.assistant_plans(id) ON DELETE SET NULL;


--
-- Name: autopilot_reviews autopilot_reviews_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_reviews
    ADD CONSTRAINT autopilot_reviews_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: autopilot_settings autopilot_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_settings
    ADD CONSTRAINT autopilot_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: autopilot_settings autopilot_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.autopilot_settings
    ADD CONSTRAINT autopilot_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: bank_lines bank_lines_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_lines
    ADD CONSTRAINT bank_lines_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: bank_lines bank_lines_entry_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_lines
    ADD CONSTRAINT bank_lines_entry_fk FOREIGN KEY (store_id, entry_id) REFERENCES commerce.ledger_entries(store_id, id);


--
-- Name: bank_lines bank_lines_statement_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_lines
    ADD CONSTRAINT bank_lines_statement_fk FOREIGN KEY (store_id, statement_id) REFERENCES commerce.bank_statements(store_id, id);


--
-- Name: bank_lines bank_lines_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_lines
    ADD CONSTRAINT bank_lines_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: bank_statements bank_statements_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_statements
    ADD CONSTRAINT bank_statements_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: bank_statements bank_statements_imported_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_statements
    ADD CONSTRAINT bank_statements_imported_by_accounts_id_fk FOREIGN KEY (imported_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: bank_statements bank_statements_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bank_statements
    ADD CONSTRAINT bank_statements_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: blog_authors blog_authors_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blog_authors
    ADD CONSTRAINT blog_authors_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: blog_comments blog_comments_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blog_comments
    ADD CONSTRAINT blog_comments_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: blog_comments blog_comments_page_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blog_comments
    ADD CONSTRAINT blog_comments_page_fk FOREIGN KEY (store_id, page_id) REFERENCES commerce.pages(store_id, id) ON DELETE CASCADE;


--
-- Name: blog_comments blog_comments_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blog_comments
    ADD CONSTRAINT blog_comments_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: blogs blogs_listing_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blogs
    ADD CONSTRAINT blogs_listing_page_id_pages_id_fk FOREIGN KEY (listing_page_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: blogs blogs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.blogs
    ADD CONSTRAINT blogs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: bonus_allocations bonus_allocations_entry_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_allocations
    ADD CONSTRAINT bonus_allocations_entry_fk FOREIGN KEY (store_id, entry_id) REFERENCES commerce.bonus_entries(store_id, id) ON DELETE CASCADE;


--
-- Name: bonus_allocations bonus_allocations_lot_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_allocations
    ADD CONSTRAINT bonus_allocations_lot_fk FOREIGN KEY (store_id, lot_id) REFERENCES commerce.bonus_entries(store_id, id) ON DELETE CASCADE;


--
-- Name: bonus_allocations bonus_allocations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_allocations
    ADD CONSTRAINT bonus_allocations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: bonus_entries bonus_entries_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: bonus_entries bonus_entries_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: bonus_entries bonus_entries_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: bonus_entries bonus_entries_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: bonus_entries bonus_entries_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_entries
    ADD CONSTRAINT bonus_entries_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: bonus_rewards bonus_rewards_discount_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_rewards
    ADD CONSTRAINT bonus_rewards_discount_fk FOREIGN KEY (store_id, discount_id) REFERENCES commerce.discount_codes(store_id, id) ON DELETE RESTRICT;


--
-- Name: bonus_rewards bonus_rewards_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_rewards
    ADD CONSTRAINT bonus_rewards_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE RESTRICT;


--
-- Name: bonus_rewards bonus_rewards_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_rewards
    ADD CONSTRAINT bonus_rewards_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: bonus_rewards bonus_rewards_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_rewards
    ADD CONSTRAINT bonus_rewards_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: bonus_settings bonus_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_settings
    ADD CONSTRAINT bonus_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: bonus_settings bonus_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bonus_settings
    ADD CONSTRAINT bonus_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: booking_resources booking_resources_host_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.booking_resources
    ADD CONSTRAINT booking_resources_host_fk FOREIGN KEY (store_id, host_id) REFERENCES commerce.hosts(store_id, id);


--
-- Name: booking_resources booking_resources_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.booking_resources
    ADD CONSTRAINT booking_resources_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: booking_seasons booking_seasons_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.booking_seasons
    ADD CONSTRAINT booking_seasons_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: bookings bookings_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bookings
    ADD CONSTRAINT bookings_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: bookings bookings_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bookings
    ADD CONSTRAINT bookings_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: bookings bookings_resource_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bookings
    ADD CONSTRAINT bookings_resource_fk FOREIGN KEY (store_id, resource_id) REFERENCES commerce.booking_resources(store_id, id);


--
-- Name: bookings bookings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bookings
    ADD CONSTRAINT bookings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bookings
    ADD CONSTRAINT bookings_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: books_email books_email_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.books_email
    ADD CONSTRAINT books_email_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: books_inbox books_inbox_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.books_inbox
    ADD CONSTRAINT books_inbox_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: books_inbox books_inbox_entry_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.books_inbox
    ADD CONSTRAINT books_inbox_entry_fk FOREIGN KEY (store_id, entry_id) REFERENCES commerce.ledger_entries(store_id, id);


--
-- Name: books_inbox books_inbox_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.books_inbox
    ADD CONSTRAINT books_inbox_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: brand_profiles brand_profiles_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.brand_profiles
    ADD CONSTRAINT brand_profiles_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: brand_profiles brand_profiles_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.brand_profiles
    ADD CONSTRAINT brand_profiles_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: broadcast_link_clicks broadcast_link_clicks_broadcast_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_link_clicks
    ADD CONSTRAINT broadcast_link_clicks_broadcast_fk FOREIGN KEY (store_id, broadcast_id) REFERENCES commerce.broadcasts(store_id, id) ON DELETE CASCADE;


--
-- Name: broadcast_link_clicks broadcast_link_clicks_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_link_clicks
    ADD CONSTRAINT broadcast_link_clicks_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: broadcast_recipients broadcast_recipients_broadcast_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_broadcast_fk FOREIGN KEY (store_id, broadcast_id) REFERENCES commerce.broadcasts(store_id, id) ON DELETE CASCADE;


--
-- Name: broadcast_recipients broadcast_recipients_email_message_id_email_messages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_email_message_id_email_messages_id_fk FOREIGN KEY (email_message_id) REFERENCES commerce.email_messages(id) ON DELETE SET NULL;


--
-- Name: broadcast_recipients broadcast_recipients_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: broadcast_recipients broadcast_recipients_subscriber_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_subscriber_fk FOREIGN KEY (store_id, subscriber_id) REFERENCES commerce.marketing_subscribers(store_id, id) ON DELETE CASCADE;


--
-- Name: broadcast_templates broadcast_templates_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_templates
    ADD CONSTRAINT broadcast_templates_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: broadcast_templates broadcast_templates_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcast_templates
    ADD CONSTRAINT broadcast_templates_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: broadcasts broadcasts_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcasts
    ADD CONSTRAINT broadcasts_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: broadcasts broadcasts_segment_id_segments_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcasts
    ADD CONSTRAINT broadcasts_segment_id_segments_id_fk FOREIGN KEY (segment_id) REFERENCES commerce.segments(id) ON DELETE SET NULL;


--
-- Name: broadcasts broadcasts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.broadcasts
    ADD CONSTRAINT broadcasts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: bulk_edit_batches bulk_edit_batches_requested_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bulk_edit_batches
    ADD CONSTRAINT bulk_edit_batches_requested_by_accounts_id_fk FOREIGN KEY (requested_by) REFERENCES commerce.accounts(id);


--
-- Name: bulk_edit_batches bulk_edit_batches_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bulk_edit_batches
    ADD CONSTRAINT bulk_edit_batches_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: bulk_edit_batches bulk_edit_batches_undo_of_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bulk_edit_batches
    ADD CONSTRAINT bulk_edit_batches_undo_of_fk FOREIGN KEY (store_id, undo_of) REFERENCES commerce.bulk_edit_batches(store_id, id);


--
-- Name: bulk_edit_items bulk_edit_items_batch_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bulk_edit_items
    ADD CONSTRAINT bulk_edit_items_batch_fk FOREIGN KEY (store_id, batch_id) REFERENCES commerce.bulk_edit_batches(store_id, id) ON DELETE CASCADE;


--
-- Name: bundle_components bundle_components_bundle_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bundle_components
    ADD CONSTRAINT bundle_components_bundle_fk FOREIGN KEY (store_id, bundle_variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: bundle_components bundle_components_component_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.bundle_components
    ADD CONSTRAINT bundle_components_component_fk FOREIGN KEY (store_id, component_variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: calendar_feeds calendar_feeds_resource_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.calendar_feeds
    ADD CONSTRAINT calendar_feeds_resource_fk FOREIGN KEY (store_id, resource_id) REFERENCES commerce.booking_resources(store_id, id) ON DELETE CASCADE;


--
-- Name: calendar_feeds calendar_feeds_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.calendar_feeds
    ADD CONSTRAINT calendar_feeds_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: campaigns campaigns_gift_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.campaigns
    ADD CONSTRAINT campaigns_gift_variant_fk FOREIGN KEY (store_id, gift_variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: campaigns campaigns_segment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.campaigns
    ADD CONSTRAINT campaigns_segment_fk FOREIGN KEY (store_id, segment_id) REFERENCES commerce.segments(store_id, id) ON DELETE RESTRICT;


--
-- Name: campaigns campaigns_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.campaigns
    ADD CONSTRAINT campaigns_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: capacity_events capacity_events_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.capacity_events
    ADD CONSTRAINT capacity_events_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: capacity_events capacity_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.capacity_events
    ADD CONSTRAINT capacity_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: carrier_labels carrier_labels_return_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carrier_labels
    ADD CONSTRAINT carrier_labels_return_fk FOREIGN KEY (store_id, return_id) REFERENCES commerce.returns(store_id, id) ON DELETE CASCADE;


--
-- Name: carrier_labels carrier_labels_shipment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carrier_labels
    ADD CONSTRAINT carrier_labels_shipment_fk FOREIGN KEY (store_id, shipment_id) REFERENCES commerce.shipments(store_id, id) ON DELETE CASCADE;


--
-- Name: cart_gift_cards cart_gift_cards_card_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_gift_cards
    ADD CONSTRAINT cart_gift_cards_card_fk FOREIGN KEY (store_id, card_id) REFERENCES commerce.gift_cards(store_id, id);


--
-- Name: cart_gift_cards cart_gift_cards_cart_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_gift_cards
    ADD CONSTRAINT cart_gift_cards_cart_fk FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts(store_id, id) ON DELETE CASCADE;


--
-- Name: cart_lines cart_lines_cart_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_lines
    ADD CONSTRAINT cart_lines_cart_fk FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts(store_id, id) ON DELETE CASCADE;


--
-- Name: cart_lines cart_lines_selling_plan_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_lines
    ADD CONSTRAINT cart_lines_selling_plan_fk FOREIGN KEY (store_id, selling_plan_id) REFERENCES commerce.selling_plans(store_id, id);


--
-- Name: cart_lines cart_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_lines
    ADD CONSTRAINT cart_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: cart_reminder_steps cart_reminder_steps_discount_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_reminder_steps
    ADD CONSTRAINT cart_reminder_steps_discount_fk FOREIGN KEY (store_id, discount_code_id) REFERENCES commerce.discount_codes(store_id, id) ON DELETE SET NULL (discount_code_id);


--
-- Name: cart_reminder_steps cart_reminder_steps_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cart_reminder_steps
    ADD CONSTRAINT cart_reminder_steps_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: carts carts_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id);


--
-- Name: carts carts_local_area_id_local_delivery_areas_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_local_area_id_local_delivery_areas_id_fk FOREIGN KEY (local_area_id) REFERENCES commerce.local_delivery_areas(id) ON DELETE SET NULL;


--
-- Name: carts carts_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code);


--
-- Name: carts carts_pickup_option_id_pickup_options_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_pickup_option_id_pickup_options_id_fk FOREIGN KEY (pickup_option_id) REFERENCES commerce.pickup_options(id) ON DELETE SET NULL;


--
-- Name: carts carts_shipping_method_id_shipping_methods_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_shipping_method_id_shipping_methods_id_fk FOREIGN KEY (shipping_method_id) REFERENCES commerce.shipping_methods(id) ON DELETE SET NULL;


--
-- Name: carts carts_vat_check_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_vat_check_fk FOREIGN KEY (store_id, vat_check_id) REFERENCES commerce.vat_checks(store_id, id);


--
-- Name: carts carts_visit_id_visits_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.carts
    ADD CONSTRAINT carts_visit_id_visits_id_fk FOREIGN KEY (visit_id) REFERENCES commerce.visits(id) ON DELETE SET NULL;


--
-- Name: chat_agents chat_agents_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.chat_agents
    ADD CONSTRAINT chat_agents_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: chat_agents chat_agents_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.chat_agents
    ADD CONSTRAINT chat_agents_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: chat_usage chat_usage_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.chat_usage
    ADD CONSTRAINT chat_usage_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: checkout_accounts checkout_accounts_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_accounts
    ADD CONSTRAINT checkout_accounts_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: checkout_accounts checkout_accounts_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_accounts
    ADD CONSTRAINT checkout_accounts_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE CASCADE;


--
-- Name: checkout_fields checkout_fields_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_fields
    ADD CONSTRAINT checkout_fields_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: checkout_providers checkout_providers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_providers
    ADD CONSTRAINT checkout_providers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: checkout_providers checkout_providers_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_providers
    ADD CONSTRAINT checkout_providers_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: checkout_rule_skips checkout_rule_skips_rule_id_checkout_rules_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rule_skips
    ADD CONSTRAINT checkout_rule_skips_rule_id_checkout_rules_id_fk FOREIGN KEY (rule_id) REFERENCES commerce.checkout_rules(id) ON DELETE CASCADE;


--
-- Name: checkout_rule_skips checkout_rule_skips_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rule_skips
    ADD CONSTRAINT checkout_rule_skips_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: checkout_rules checkout_rules_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rules
    ADD CONSTRAINT checkout_rules_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: checkout_rules checkout_rules_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rules
    ADD CONSTRAINT checkout_rules_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: checkout_rules checkout_rules_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.checkout_rules
    ADD CONSTRAINT checkout_rules_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: company_invites company_invites_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_invites
    ADD CONSTRAINT company_invites_company_fk FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies(store_id, id) ON DELETE CASCADE;


--
-- Name: company_location_buyers company_location_buyers_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_location_buyers
    ADD CONSTRAINT company_location_buyers_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: company_location_buyers company_location_buyers_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_location_buyers
    ADD CONSTRAINT company_location_buyers_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.company_locations(store_id, id) ON DELETE CASCADE;


--
-- Name: company_locations company_locations_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.company_locations
    ADD CONSTRAINT company_locations_company_fk FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies(store_id, id) ON DELETE CASCADE;


--
-- Name: consents consents_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.consents
    ADD CONSTRAINT consents_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: content_entries content_entries_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_entries
    ADD CONSTRAINT content_entries_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: content_entries content_entries_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_entries
    ADD CONSTRAINT content_entries_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: content_entries content_entries_type_id_content_types_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_entries
    ADD CONSTRAINT content_entries_type_id_content_types_id_fk FOREIGN KEY (type_id) REFERENCES commerce.content_types(id) ON DELETE CASCADE;


--
-- Name: content_entries content_entries_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_entries
    ADD CONSTRAINT content_entries_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: content_reports content_reports_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_reports
    ADD CONSTRAINT content_reports_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: content_reports content_reports_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_reports
    ADD CONSTRAINT content_reports_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES commerce.products(id) ON DELETE SET NULL;


--
-- Name: content_reports content_reports_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_reports
    ADD CONSTRAINT content_reports_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE SET NULL;


--
-- Name: content_screened content_screened_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_screened
    ADD CONSTRAINT content_screened_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES commerce.products(id) ON DELETE CASCADE;


--
-- Name: content_screened content_screened_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_screened
    ADD CONSTRAINT content_screened_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: content_types content_types_layout_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_types
    ADD CONSTRAINT content_types_layout_id_pages_id_fk FOREIGN KEY (layout_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: content_types content_types_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_types
    ADD CONSTRAINT content_types_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: content_types content_types_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.content_types
    ADD CONSTRAINT content_types_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: cookie_notes cookie_notes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cookie_notes
    ADD CONSTRAINT cookie_notes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: cookie_notes cookie_notes_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cookie_notes
    ADD CONSTRAINT cookie_notes_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: cookie_scans cookie_scans_requested_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cookie_scans
    ADD CONSTRAINT cookie_scans_requested_by_accounts_id_fk FOREIGN KEY (requested_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: cookie_scans cookie_scans_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.cookie_scans
    ADD CONSTRAINT cookie_scans_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: creator_attributions creator_attributions_creator_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_attributions
    ADD CONSTRAINT creator_attributions_creator_fk FOREIGN KEY (store_id, creator_id) REFERENCES commerce.creators(store_id, id);


--
-- Name: creator_attributions creator_attributions_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_attributions
    ADD CONSTRAINT creator_attributions_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: creator_attributions creator_attributions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_attributions
    ADD CONSTRAINT creator_attributions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: creator_commissions creator_commissions_creator_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_commissions
    ADD CONSTRAINT creator_commissions_creator_fk FOREIGN KEY (store_id, creator_id) REFERENCES commerce.creators(store_id, id);


--
-- Name: creator_commissions creator_commissions_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_commissions
    ADD CONSTRAINT creator_commissions_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: creator_commissions creator_commissions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_commissions
    ADD CONSTRAINT creator_commissions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: creator_payouts creator_payouts_creator_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_payouts
    ADD CONSTRAINT creator_payouts_creator_fk FOREIGN KEY (store_id, creator_id) REFERENCES commerce.creators(store_id, id);


--
-- Name: creator_payouts creator_payouts_recorded_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_payouts
    ADD CONSTRAINT creator_payouts_recorded_by_accounts_id_fk FOREIGN KEY (recorded_by) REFERENCES commerce.accounts(id);


--
-- Name: creator_payouts creator_payouts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_payouts
    ADD CONSTRAINT creator_payouts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: creator_settings creator_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_settings
    ADD CONSTRAINT creator_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: creator_settings creator_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creator_settings
    ADD CONSTRAINT creator_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: creators creators_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creators
    ADD CONSTRAINT creators_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id);


--
-- Name: creators creators_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creators
    ADD CONSTRAINT creators_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id);


--
-- Name: creators creators_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.creators
    ADD CONSTRAINT creators_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: credit_notes credit_notes_invoice_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_invoice_fk FOREIGN KEY (store_id, invoice_id) REFERENCES commerce.invoices(store_id, id);


--
-- Name: credit_notes credit_notes_order_edit_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_order_edit_fk FOREIGN KEY (store_id, order_edit_id) REFERENCES commerce.order_edits(store_id, id);


--
-- Name: credit_notes credit_notes_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: credit_notes credit_notes_return_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_return_fk FOREIGN KEY (store_id, return_id) REFERENCES commerce.returns(store_id, id);


--
-- Name: credit_notes credit_notes_series_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.credit_notes
    ADD CONSTRAINT credit_notes_series_fk FOREIGN KEY (store_id, series) REFERENCES commerce.document_series(store_id, series);


--
-- Name: crm_move_links crm_move_links_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.crm_move_links
    ADD CONSTRAINT crm_move_links_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: crm_moves crm_moves_connected_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.crm_moves
    ADD CONSTRAINT crm_moves_connected_by_accounts_id_fk FOREIGN KEY (connected_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: crm_moves crm_moves_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.crm_moves
    ADD CONSTRAINT crm_moves_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: css_versions css_versions_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.css_versions
    ADD CONSTRAINT css_versions_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: css_versions css_versions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.css_versions
    ADD CONSTRAINT css_versions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: custom_apps custom_apps_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.custom_apps
    ADD CONSTRAINT custom_apps_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: custom_apps custom_apps_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.custom_apps
    ADD CONSTRAINT custom_apps_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customer_addresses customer_addresses_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_addresses
    ADD CONSTRAINT customer_addresses_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: customer_addresses customer_addresses_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_addresses
    ADD CONSTRAINT customer_addresses_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customer_codes customer_codes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_codes
    ADD CONSTRAINT customer_codes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customer_companies customer_companies_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_companies
    ADD CONSTRAINT customer_companies_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customer_companies customer_companies_tier_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_companies
    ADD CONSTRAINT customer_companies_tier_fk FOREIGN KEY (store_id, tier_id) REFERENCES commerce.customer_tiers(store_id, id);


--
-- Name: customer_notes customer_notes_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_notes
    ADD CONSTRAINT customer_notes_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: customer_notes customer_notes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_notes
    ADD CONSTRAINT customer_notes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customer_sessions customer_sessions_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_sessions
    ADD CONSTRAINT customer_sessions_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: customer_sign_in_links customer_sign_in_links_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_sign_in_links
    ADD CONSTRAINT customer_sign_in_links_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: customer_tags customer_tags_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_tags
    ADD CONSTRAINT customer_tags_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: customer_tags customer_tags_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_tags
    ADD CONSTRAINT customer_tags_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customer_tiers customer_tiers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customer_tiers
    ADD CONSTRAINT customer_tiers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customers customers_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customers
    ADD CONSTRAINT customers_company_fk FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies(store_id, id);


--
-- Name: customers customers_referred_by_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customers
    ADD CONSTRAINT customers_referred_by_fk FOREIGN KEY (store_id, referred_by_customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (referred_by_customer_id);


--
-- Name: customers customers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customers
    ADD CONSTRAINT customers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: customers customers_tier_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customers
    ADD CONSTRAINT customers_tier_fk FOREIGN KEY (store_id, tier_id) REFERENCES commerce.customer_tiers(store_id, id);


--
-- Name: customs_settings customs_settings_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.customs_settings
    ADD CONSTRAINT customs_settings_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code);


--
-- Name: data_job_assets data_job_assets_job_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_job_assets
    ADD CONSTRAINT data_job_assets_job_fk FOREIGN KEY (store_id, job_id) REFERENCES commerce.data_jobs(store_id, id) ON DELETE CASCADE;


--
-- Name: data_job_items data_job_items_job_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_job_items
    ADD CONSTRAINT data_job_items_job_fk FOREIGN KEY (store_id, job_id) REFERENCES commerce.data_jobs(store_id, id) ON DELETE CASCADE;


--
-- Name: data_jobs data_jobs_requested_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_jobs
    ADD CONSTRAINT data_jobs_requested_by_accounts_id_fk FOREIGN KEY (requested_by) REFERENCES commerce.accounts(id);


--
-- Name: data_jobs data_jobs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.data_jobs
    ADD CONSTRAINT data_jobs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: deal_links deal_links_assignment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_links
    ADD CONSTRAINT deal_links_assignment_fk FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments(store_id, id) ON DELETE CASCADE;


--
-- Name: deal_links deal_links_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_links
    ADD CONSTRAINT deal_links_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: deal_links deal_links_deal_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_links
    ADD CONSTRAINT deal_links_deal_fk FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals(store_id, id) ON DELETE CASCADE;


--
-- Name: deal_links deal_links_draft_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_links
    ADD CONSTRAINT deal_links_draft_fk FOREIGN KEY (store_id, draft_id) REFERENCES commerce.draft_orders(store_id, id) ON DELETE CASCADE;


--
-- Name: deal_links deal_links_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_links
    ADD CONSTRAINT deal_links_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: deal_links deal_links_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_links
    ADD CONSTRAINT deal_links_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: deal_moves deal_moves_deal_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_moves
    ADD CONSTRAINT deal_moves_deal_fk FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals(store_id, id) ON DELETE CASCADE;


--
-- Name: deal_moves deal_moves_moved_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_moves
    ADD CONSTRAINT deal_moves_moved_by_accounts_id_fk FOREIGN KEY (moved_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: deal_moves deal_moves_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_moves
    ADD CONSTRAINT deal_moves_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: deal_pipelines deal_pipelines_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_pipelines
    ADD CONSTRAINT deal_pipelines_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: deal_stages deal_stages_pipeline_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_stages
    ADD CONSTRAINT deal_stages_pipeline_fk FOREIGN KEY (store_id, pipeline_id) REFERENCES commerce.deal_pipelines(store_id, id) ON DELETE CASCADE;


--
-- Name: deal_stages deal_stages_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deal_stages
    ADD CONSTRAINT deal_stages_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: deals deals_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_company_fk FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies(store_id, id) ON DELETE SET NULL (company_id);


--
-- Name: deals deals_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: deals deals_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (customer_id);


--
-- Name: deals deals_owner_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_owner_id_accounts_id_fk FOREIGN KEY (owner_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: deals deals_stage_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_stage_fk FOREIGN KEY (store_id, pipeline_id, stage_id) REFERENCES commerce.deal_stages(store_id, pipeline_id, id);


--
-- Name: deals deals_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.deals
    ADD CONSTRAINT deals_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: delivery_quotes delivery_quotes_cart_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.delivery_quotes
    ADD CONSTRAINT delivery_quotes_cart_fk FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts(store_id, id) ON DELETE CASCADE;


--
-- Name: delivery_schedules delivery_schedules_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.delivery_schedules
    ADD CONSTRAINT delivery_schedules_market_fk FOREIGN KEY (store_id, market_code, currency) REFERENCES commerce.markets(store_id, code, currency);


--
-- Name: delivery_schedules delivery_schedules_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.delivery_schedules
    ADD CONSTRAINT delivery_schedules_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: design_preset_uses design_preset_uses_applied_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_applied_by_accounts_id_fk FOREIGN KEY (applied_by) REFERENCES commerce.accounts(id);


--
-- Name: design_preset_uses design_preset_uses_install_id_store_theme_installs_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_install_id_store_theme_installs_id_fk FOREIGN KEY (install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE SET NULL;


--
-- Name: design_preset_uses design_preset_uses_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id);


--
-- Name: design_preset_uses design_preset_uses_previous_install_id_store_theme_installs_id_; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_previous_install_id_store_theme_installs_id_ FOREIGN KEY (previous_install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE SET NULL;


--
-- Name: design_preset_uses design_preset_uses_restored_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_restored_by_accounts_id_fk FOREIGN KEY (restored_by) REFERENCES commerce.accounts(id);


--
-- Name: design_preset_uses design_preset_uses_saved_theme_id_store_themes_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_saved_theme_id_store_themes_id_fk FOREIGN KEY (saved_theme_id) REFERENCES commerce.store_themes(id) ON DELETE SET NULL;


--
-- Name: design_preset_uses design_preset_uses_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_uses
    ADD CONSTRAINT design_preset_uses_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: design_preset_versions design_preset_versions_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_versions
    ADD CONSTRAINT design_preset_versions_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id) ON DELETE CASCADE;


--
-- Name: design_preset_versions design_preset_versions_published_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_preset_versions
    ADD CONSTRAINT design_preset_versions_published_by_accounts_id_fk FOREIGN KEY (published_by) REFERENCES commerce.accounts(id);


--
-- Name: design_presets design_presets_archived_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_presets
    ADD CONSTRAINT design_presets_archived_by_accounts_id_fk FOREIGN KEY (archived_by) REFERENCES commerce.accounts(id);


--
-- Name: design_presets design_presets_author_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_presets
    ADD CONSTRAINT design_presets_author_id_accounts_id_fk FOREIGN KEY (author_id) REFERENCES commerce.accounts(id);


--
-- Name: design_presets design_presets_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_presets
    ADD CONSTRAINT design_presets_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: design_presets design_presets_source_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_presets
    ADD CONSTRAINT design_presets_source_store_id_stores_id_fk FOREIGN KEY (source_store_id) REFERENCES commerce.stores(id);


--
-- Name: design_presets design_presets_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_presets
    ADD CONSTRAINT design_presets_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: design_presets design_presets_workspace_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_presets
    ADD CONSTRAINT design_presets_workspace_store_id_stores_id_fk FOREIGN KEY (workspace_store_id) REFERENCES commerce.stores(id);


--
-- Name: design_variations design_variations_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_variations
    ADD CONSTRAINT design_variations_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: design_variations design_variations_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_variations
    ADD CONSTRAINT design_variations_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id) ON DELETE CASCADE;


--
-- Name: design_variations design_variations_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.design_variations
    ADD CONSTRAINT design_variations_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: developers developers_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.developers
    ADD CONSTRAINT developers_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: discount_code_items discount_code_items_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_code_items
    ADD CONSTRAINT discount_code_items_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES commerce.customers(id) ON DELETE SET NULL;


--
-- Name: discount_code_items discount_code_items_discount_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_code_items
    ADD CONSTRAINT discount_code_items_discount_fk FOREIGN KEY (store_id, discount_id) REFERENCES commerce.discount_codes(store_id, id) ON DELETE CASCADE;


--
-- Name: discount_code_items discount_code_items_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_code_items
    ADD CONSTRAINT discount_code_items_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: discount_codes discount_codes_segment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_codes
    ADD CONSTRAINT discount_codes_segment_fk FOREIGN KEY (store_id, segment_id) REFERENCES commerce.segments(store_id, id) ON DELETE RESTRICT;


--
-- Name: discount_codes discount_codes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.discount_codes
    ADD CONSTRAINT discount_codes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: dispute_evidence dispute_evidence_dispute_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dispute_evidence
    ADD CONSTRAINT dispute_evidence_dispute_fk FOREIGN KEY (store_id, dispute_id) REFERENCES commerce.payment_disputes(store_id, id) ON DELETE CASCADE;


--
-- Name: dispute_evidence dispute_evidence_saved_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dispute_evidence
    ADD CONSTRAINT dispute_evidence_saved_by_accounts_id_fk FOREIGN KEY (saved_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: dispute_evidence dispute_evidence_submitted_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dispute_evidence
    ADD CONSTRAINT dispute_evidence_submitted_by_accounts_id_fk FOREIGN KEY (submitted_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: dns_changes dns_changes_actor_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_changes
    ADD CONSTRAINT dns_changes_actor_id_accounts_id_fk FOREIGN KEY (actor_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: dns_changes dns_changes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_changes
    ADD CONSTRAINT dns_changes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: dns_changes dns_changes_zone_id_dns_zones_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_changes
    ADD CONSTRAINT dns_changes_zone_id_dns_zones_id_fk FOREIGN KEY (zone_id) REFERENCES commerce.dns_zones(id);


--
-- Name: dns_zones dns_zones_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_zones
    ADD CONSTRAINT dns_zones_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: dns_zones dns_zones_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_zones
    ADD CONSTRAINT dns_zones_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: dns_zones dns_zones_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dns_zones
    ADD CONSTRAINT dns_zones_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: docs_guide_messages docs_guide_messages_conversation_id_docs_guide_conversations_id; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_guide_messages
    ADD CONSTRAINT docs_guide_messages_conversation_id_docs_guide_conversations_id FOREIGN KEY (conversation_id) REFERENCES commerce.docs_guide_conversations(id) ON DELETE CASCADE;


--
-- Name: docs_guide docs_guide_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.docs_guide
    ADD CONSTRAINT docs_guide_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: document_deliveries document_deliveries_email_message_id_email_messages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_deliveries
    ADD CONSTRAINT document_deliveries_email_message_id_email_messages_id_fk FOREIGN KEY (email_message_id) REFERENCES commerce.email_messages(id);


--
-- Name: document_deliveries document_deliveries_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_deliveries
    ADD CONSTRAINT document_deliveries_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: document_pdf_state document_pdf_state_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_pdf_state
    ADD CONSTRAINT document_pdf_state_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: document_series document_series_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.document_series
    ADD CONSTRAINT document_series_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: domain_pricing domain_pricing_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_pricing
    ADD CONSTRAINT domain_pricing_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: domain_purchases domain_purchases_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: domain_purchases domain_purchases_chosen_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_chosen_by_accounts_id_fk FOREIGN KEY (chosen_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: domain_purchases domain_purchases_registrant_id_domain_registrants_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_registrant_id_domain_registrants_id_fk FOREIGN KEY (registrant_id) REFERENCES commerce.domain_registrants(id);


--
-- Name: domain_purchases domain_purchases_registration_id_domain_registrations_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_registration_id_domain_registrations_id_fk FOREIGN KEY (registration_id) REFERENCES commerce.domain_registrations(id);


--
-- Name: domain_purchases domain_purchases_reviewed_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_reviewed_by_accounts_id_fk FOREIGN KEY (reviewed_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: domain_purchases domain_purchases_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_purchases
    ADD CONSTRAINT domain_purchases_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: domain_registrants domain_registrants_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrants
    ADD CONSTRAINT domain_registrants_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: domain_registrants domain_registrants_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrants
    ADD CONSTRAINT domain_registrants_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: domain_registrants domain_registrants_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrants
    ADD CONSTRAINT domain_registrants_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: domain_registrations domain_registrations_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrations
    ADD CONSTRAINT domain_registrations_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: domain_registrations domain_registrations_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrations
    ADD CONSTRAINT domain_registrations_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: domain_registrations domain_registrations_registrant_id_domain_registrants_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrations
    ADD CONSTRAINT domain_registrations_registrant_id_domain_registrants_id_fk FOREIGN KEY (registrant_id) REFERENCES commerce.domain_registrants(id);


--
-- Name: domain_registrations domain_registrations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.domain_registrations
    ADD CONSTRAINT domain_registrations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: draft_order_lines draft_order_lines_draft_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_order_lines
    ADD CONSTRAINT draft_order_lines_draft_fk FOREIGN KEY (store_id, draft_id) REFERENCES commerce.draft_orders(store_id, id) ON DELETE CASCADE;


--
-- Name: draft_order_lines draft_order_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_order_lines
    ADD CONSTRAINT draft_order_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: draft_order_lines draft_order_lines_vat_category_vat_categories_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_order_lines
    ADD CONSTRAINT draft_order_lines_vat_category_vat_categories_code_fk FOREIGN KEY (vat_category) REFERENCES commerce.vat_categories(code);


--
-- Name: draft_orders draft_orders_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: draft_orders draft_orders_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (customer_id);


--
-- Name: draft_orders draft_orders_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code);


--
-- Name: draft_orders draft_orders_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: draft_orders draft_orders_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.draft_orders
    ADD CONSTRAINT draft_orders_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: dream_runs dream_runs_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dream_runs
    ADD CONSTRAINT dream_runs_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: dream_runs dream_runs_conversation_id_assistant_conversations_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dream_runs
    ADD CONSTRAINT dream_runs_conversation_id_assistant_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE SET NULL;


--
-- Name: dream_runs dream_runs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.dream_runs
    ADD CONSTRAINT dream_runs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: duty_rates duty_rates_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.duty_rates
    ADD CONSTRAINT duty_rates_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: economic_operators economic_operators_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.economic_operators
    ADD CONSTRAINT economic_operators_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: einvoice_sends einvoice_sends_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.einvoice_sends
    ADD CONSTRAINT einvoice_sends_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: email_filing email_filing_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_filing
    ADD CONSTRAINT email_filing_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: email_messages email_messages_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_messages
    ADD CONSTRAINT email_messages_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: email_opt_outs email_opt_outs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_opt_outs
    ADD CONSTRAINT email_opt_outs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: email_templates email_templates_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_templates
    ADD CONSTRAINT email_templates_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: email_templates email_templates_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.email_templates
    ADD CONSTRAINT email_templates_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: experiment_carts experiment_carts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_carts
    ADD CONSTRAINT experiment_carts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: experiment_events experiment_events_exposure_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_events
    ADD CONSTRAINT experiment_events_exposure_fk FOREIGN KEY (experiment_id, visitor) REFERENCES commerce.experiment_exposures(experiment_id, visitor) ON DELETE CASCADE;


--
-- Name: experiment_events experiment_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_events
    ADD CONSTRAINT experiment_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: experiment_exposures experiment_exposures_experiment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_exposures
    ADD CONSTRAINT experiment_exposures_experiment_fk FOREIGN KEY (store_id, experiment_id) REFERENCES commerce.experiments(store_id, id) ON DELETE CASCADE;


--
-- Name: experiment_exposures experiment_exposures_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_exposures
    ADD CONSTRAINT experiment_exposures_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: experiment_exposures experiment_exposures_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_exposures
    ADD CONSTRAINT experiment_exposures_variant_fk FOREIGN KEY (experiment_id, variant) REFERENCES commerce.experiment_variants(experiment_id, key) ON DELETE CASCADE;


--
-- Name: experiment_variants experiment_variants_experiment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_variants
    ADD CONSTRAINT experiment_variants_experiment_fk FOREIGN KEY (store_id, experiment_id) REFERENCES commerce.experiments(store_id, id) ON DELETE CASCADE;


--
-- Name: experiment_variants experiment_variants_page_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_variants
    ADD CONSTRAINT experiment_variants_page_fk FOREIGN KEY (store_id, page_id) REFERENCES commerce.pages(store_id, id);


--
-- Name: experiment_variants experiment_variants_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiment_variants
    ADD CONSTRAINT experiment_variants_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: experiments experiments_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiments
    ADD CONSTRAINT experiments_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: experiments experiments_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiments
    ADD CONSTRAINT experiments_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: experiments experiments_target_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiments
    ADD CONSTRAINT experiments_target_fk FOREIGN KEY (store_id, target_page_id) REFERENCES commerce.pages(store_id, id);


--
-- Name: experiments experiments_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.experiments
    ADD CONSTRAINT experiments_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: feed_settings feed_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.feed_settings
    ADD CONSTRAINT feed_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: field_groups field_groups_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_groups
    ADD CONSTRAINT field_groups_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: field_search field_search_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_search
    ADD CONSTRAINT field_search_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: field_values field_values_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.field_values
    ADD CONSTRAINT field_values_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: fiken_connections fiken_connections_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.fiken_connections
    ADD CONSTRAINT fiken_connections_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: fiken_connections fiken_connections_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.fiken_connections
    ADD CONSTRAINT fiken_connections_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: fiken_sync fiken_sync_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.fiken_sync
    ADD CONSTRAINT fiken_sync_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: filed_emails filed_emails_filed_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.filed_emails
    ADD CONSTRAINT filed_emails_filed_by_accounts_id_fk FOREIGN KEY (filed_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: filed_emails filed_emails_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.filed_emails
    ADD CONSTRAINT filed_emails_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: form_submissions form_submissions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.form_submissions
    ADD CONSTRAINT form_submissions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: gift_card_entries gift_card_entries_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_card_entries
    ADD CONSTRAINT gift_card_entries_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: gift_card_entries gift_card_entries_card_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_card_entries
    ADD CONSTRAINT gift_card_entries_card_fk FOREIGN KEY (store_id, card_id) REFERENCES commerce.gift_cards(store_id, id);


--
-- Name: gift_card_entries gift_card_entries_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_card_entries
    ADD CONSTRAINT gift_card_entries_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: gift_card_settings gift_card_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_card_settings
    ADD CONSTRAINT gift_card_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: gift_cards gift_cards_deactivated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_cards
    ADD CONSTRAINT gift_cards_deactivated_by_accounts_id_fk FOREIGN KEY (deactivated_by) REFERENCES commerce.accounts(id);


--
-- Name: gift_cards gift_cards_issued_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_cards
    ADD CONSTRAINT gift_cards_issued_by_accounts_id_fk FOREIGN KEY (issued_by) REFERENCES commerce.accounts(id);


--
-- Name: gift_cards gift_cards_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_cards
    ADD CONSTRAINT gift_cards_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: gift_cards gift_cards_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_cards
    ADD CONSTRAINT gift_cards_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: gift_cards gift_cards_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.gift_cards
    ADD CONSTRAINT gift_cards_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: google_places google_places_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.google_places
    ADD CONSTRAINT google_places_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: google_places google_places_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.google_places
    ADD CONSTRAINT google_places_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: host_commissions host_commissions_host_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_commissions
    ADD CONSTRAINT host_commissions_host_fk FOREIGN KEY (store_id, host_id) REFERENCES commerce.hosts(store_id, id);


--
-- Name: host_commissions host_commissions_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_commissions
    ADD CONSTRAINT host_commissions_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: host_commissions host_commissions_payment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_commissions
    ADD CONSTRAINT host_commissions_payment_fk FOREIGN KEY (store_id, payment_id) REFERENCES commerce.payments(store_id, id);


--
-- Name: host_stripe_accounts host_stripe_accounts_host_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_stripe_accounts
    ADD CONSTRAINT host_stripe_accounts_host_fk FOREIGN KEY (store_id, host_id) REFERENCES commerce.hosts(store_id, id) ON DELETE CASCADE;


--
-- Name: host_tax_details host_tax_details_host_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.host_tax_details
    ADD CONSTRAINT host_tax_details_host_fk FOREIGN KEY (store_id, host_id) REFERENCES commerce.hosts(store_id, id) ON DELETE CASCADE;


--
-- Name: hosts hosts_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.hosts
    ADD CONSTRAINT hosts_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: hosts hosts_invited_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.hosts
    ADD CONSTRAINT hosts_invited_by_accounts_id_fk FOREIGN KEY (invited_by) REFERENCES commerce.accounts(id);


--
-- Name: hosts hosts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.hosts
    ADD CONSTRAINT hosts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: house_customer_links house_customer_links_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_customer_links
    ADD CONSTRAINT house_customer_links_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: house_customer_links house_customer_links_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_customer_links
    ADD CONSTRAINT house_customer_links_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: house_customer_links house_customer_links_deal_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_customer_links
    ADD CONSTRAINT house_customer_links_deal_fk FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals(store_id, id) ON DELETE SET NULL (deal_id);


--
-- Name: house_customer_links house_customer_links_request_id_access_requests_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_customer_links
    ADD CONSTRAINT house_customer_links_request_id_access_requests_id_fk FOREIGN KEY (request_id) REFERENCES commerce.access_requests(id) ON DELETE SET NULL;


--
-- Name: house_customer_links house_customer_links_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_customer_links
    ADD CONSTRAINT house_customer_links_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: house_site_copies house_site_copies_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.house_site_copies
    ADD CONSTRAINT house_site_copies_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: idempotency_keys idempotency_keys_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.idempotency_keys
    ADD CONSTRAINT idempotency_keys_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: instagram_accounts instagram_accounts_connected_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.instagram_accounts
    ADD CONSTRAINT instagram_accounts_connected_by_accounts_id_fk FOREIGN KEY (connected_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: instagram_accounts instagram_accounts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.instagram_accounts
    ADD CONSTRAINT instagram_accounts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: integration_deliveries integration_deliveries_endpoint_id_webhook_endpoints_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.integration_deliveries
    ADD CONSTRAINT integration_deliveries_endpoint_id_webhook_endpoints_id_fk FOREIGN KEY (endpoint_id) REFERENCES commerce.webhook_endpoints(id) ON DELETE CASCADE;


--
-- Name: integration_deliveries integration_deliveries_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.integration_deliveries
    ADD CONSTRAINT integration_deliveries_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: inventory_levels inventory_levels_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_levels
    ADD CONSTRAINT inventory_levels_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.inventory_locations(store_id, id);


--
-- Name: inventory_levels inventory_levels_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_levels
    ADD CONSTRAINT inventory_levels_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: inventory_locations inventory_locations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_locations
    ADD CONSTRAINT inventory_locations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: inventory_locations inventory_locations_supplier_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_locations
    ADD CONSTRAINT inventory_locations_supplier_fk FOREIGN KEY (store_id, supplier_id) REFERENCES commerce.suppliers(store_id, id);


--
-- Name: inventory_movements inventory_movements_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_movements
    ADD CONSTRAINT inventory_movements_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.inventory_locations(store_id, id);


--
-- Name: inventory_movements inventory_movements_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_movements
    ADD CONSTRAINT inventory_movements_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: inventory_movements inventory_movements_return_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_movements
    ADD CONSTRAINT inventory_movements_return_fk FOREIGN KEY (store_id, return_id) REFERENCES commerce.returns(store_id, id);


--
-- Name: inventory_movements inventory_movements_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_movements
    ADD CONSTRAINT inventory_movements_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: inventory_reservations inventory_reservations_cart_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_reservations
    ADD CONSTRAINT inventory_reservations_cart_fk FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts(store_id, id) ON DELETE CASCADE;


--
-- Name: inventory_reservations inventory_reservations_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_reservations
    ADD CONSTRAINT inventory_reservations_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.inventory_locations(store_id, id);


--
-- Name: inventory_reservations inventory_reservations_order_edit_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_edit_fk FOREIGN KEY (store_id, order_edit_id) REFERENCES commerce.order_edits(store_id, id);


--
-- Name: inventory_reservations inventory_reservations_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: inventory_reservations inventory_reservations_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.inventory_reservations
    ADD CONSTRAINT inventory_reservations_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: invoice_settings invoice_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoice_settings
    ADD CONSTRAINT invoice_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: invoice_settings invoice_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoice_settings
    ADD CONSTRAINT invoice_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: invoices invoices_order_edit_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_order_edit_fk FOREIGN KEY (store_id, order_edit_id) REFERENCES commerce.order_edits(store_id, id);


--
-- Name: invoices invoices_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: invoices invoices_series_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.invoices
    ADD CONSTRAINT invoices_series_fk FOREIGN KEY (store_id, series) REFERENCES commerce.document_series(store_id, series);


--
-- Name: kaizen_life_accounts kaizen_life_accounts_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.kaizen_life_accounts
    ADD CONSTRAINT kaizen_life_accounts_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: kaizen_life_handoffs kaizen_life_handoffs_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.kaizen_life_handoffs
    ADD CONSTRAINT kaizen_life_handoffs_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: kaizen_life_handoffs kaizen_life_handoffs_conversation_id_assistant_conversations_id; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.kaizen_life_handoffs
    ADD CONSTRAINT kaizen_life_handoffs_conversation_id_assistant_conversations_id FOREIGN KEY (conversation_id) REFERENCES commerce.assistant_conversations(id) ON DELETE SET NULL;


--
-- Name: kaizen_life_handoffs kaizen_life_handoffs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.kaizen_life_handoffs
    ADD CONSTRAINT kaizen_life_handoffs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES commerce.knowledge_documents(id) ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_entry_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES commerce.content_entries(id) ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_page_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_page_id_fkey FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_store_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_store_id_fkey FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: knowledge_documents knowledge_documents_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_documents
    ADD CONSTRAINT knowledge_documents_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: knowledge_documents knowledge_documents_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.knowledge_documents
    ADD CONSTRAINT knowledge_documents_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: lead_decisions lead_decisions_deal_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.lead_decisions
    ADD CONSTRAINT lead_decisions_deal_fk FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals(store_id, id) ON DELETE SET NULL (deal_id);


--
-- Name: lead_decisions lead_decisions_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.lead_decisions
    ADD CONSTRAINT lead_decisions_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: lead_decisions lead_decisions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.lead_decisions
    ADD CONSTRAINT lead_decisions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_accounts ledger_accounts_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_accounts
    ADD CONSTRAINT ledger_accounts_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: ledger_accounts ledger_accounts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_accounts
    ADD CONSTRAINT ledger_accounts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_books ledger_books_locked_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_books
    ADD CONSTRAINT ledger_books_locked_by_accounts_id_fk FOREIGN KEY (locked_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ledger_books ledger_books_opened_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_books
    ADD CONSTRAINT ledger_books_opened_by_accounts_id_fk FOREIGN KEY (opened_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ledger_books ledger_books_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_books
    ADD CONSTRAINT ledger_books_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_budgets ledger_budgets_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_budgets
    ADD CONSTRAINT ledger_budgets_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: ledger_budgets ledger_budgets_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_budgets
    ADD CONSTRAINT ledger_budgets_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_budgets ledger_budgets_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_budgets
    ADD CONSTRAINT ledger_budgets_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ledger_comparisons ledger_comparisons_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_comparisons
    ADD CONSTRAINT ledger_comparisons_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: ledger_comparisons ledger_comparisons_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_comparisons
    ADD CONSTRAINT ledger_comparisons_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_counters ledger_counters_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_counters
    ADD CONSTRAINT ledger_counters_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: ledger_counters ledger_counters_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_counters
    ADD CONSTRAINT ledger_counters_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_entries ledger_entries_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_entries
    ADD CONSTRAINT ledger_entries_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: ledger_entries ledger_entries_posted_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_entries
    ADD CONSTRAINT ledger_entries_posted_by_accounts_id_fk FOREIGN KEY (posted_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ledger_entries ledger_entries_reverses_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_entries
    ADD CONSTRAINT ledger_entries_reverses_fk FOREIGN KEY (reverses) REFERENCES commerce.ledger_entries(id);


--
-- Name: ledger_entries ledger_entries_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_entries
    ADD CONSTRAINT ledger_entries_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_lines ledger_lines_account_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_lines
    ADD CONSTRAINT ledger_lines_account_fk FOREIGN KEY (book_id, account) REFERENCES commerce.ledger_accounts(book_id, number);


--
-- Name: ledger_lines ledger_lines_entry_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_lines
    ADD CONSTRAINT ledger_lines_entry_fk FOREIGN KEY (store_id, entry_id) REFERENCES commerce.ledger_entries(store_id, id);


--
-- Name: ledger_lines ledger_lines_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_lines
    ADD CONSTRAINT ledger_lines_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_vouchers ledger_vouchers_bank_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_bank_line_fk FOREIGN KEY (store_id, bank_line_id) REFERENCES commerce.bank_lines(store_id, id);


--
-- Name: ledger_vouchers ledger_vouchers_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: ledger_vouchers ledger_vouchers_entry_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_entry_fk FOREIGN KEY (store_id, entry_id) REFERENCES commerce.ledger_entries(store_id, id);


--
-- Name: ledger_vouchers ledger_vouchers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ledger_vouchers ledger_vouchers_uploaded_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_vouchers
    ADD CONSTRAINT ledger_vouchers_uploaded_by_accounts_id_fk FOREIGN KEY (uploaded_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: ledger_waiting ledger_waiting_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_waiting
    ADD CONSTRAINT ledger_waiting_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: ledger_waiting ledger_waiting_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ledger_waiting
    ADD CONSTRAINT ledger_waiting_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: legal_ai_settings legal_ai_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_ai_settings
    ADD CONSTRAINT legal_ai_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: legal_ai_settings legal_ai_settings_turned_on_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_ai_settings
    ADD CONSTRAINT legal_ai_settings_turned_on_by_accounts_id_fk FOREIGN KEY (turned_on_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: legal_ai_writes legal_ai_writes_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_ai_writes
    ADD CONSTRAINT legal_ai_writes_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: legal_ai_writes legal_ai_writes_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_ai_writes
    ADD CONSTRAINT legal_ai_writes_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: legal_ai_writes legal_ai_writes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_ai_writes
    ADD CONSTRAINT legal_ai_writes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: legal_snapshots legal_snapshots_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_snapshots
    ADD CONSTRAINT legal_snapshots_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: legal_source_reads legal_source_reads_text_hash_legal_source_texts_hash_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.legal_source_reads
    ADD CONSTRAINT legal_source_reads_text_hash_legal_source_texts_hash_fk FOREIGN KEY (text_hash) REFERENCES commerce.legal_source_texts(hash) ON DELETE RESTRICT;


--
-- Name: limit_overrides limit_overrides_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.limit_overrides
    ADD CONSTRAINT limit_overrides_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: limit_overrides limit_overrides_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.limit_overrides
    ADD CONSTRAINT limit_overrides_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: limit_overrides limit_overrides_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.limit_overrides
    ADD CONSTRAINT limit_overrides_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: live_drills live_drills_requested_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.live_drills
    ADD CONSTRAINT live_drills_requested_by_accounts_id_fk FOREIGN KEY (requested_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: live_drills live_drills_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.live_drills
    ADD CONSTRAINT live_drills_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: local_delivery_areas local_delivery_areas_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.local_delivery_areas
    ADD CONSTRAINT local_delivery_areas_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.store_locations(store_id, id) ON DELETE CASCADE;


--
-- Name: local_delivery_areas local_delivery_areas_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.local_delivery_areas
    ADD CONSTRAINT local_delivery_areas_market_fk FOREIGN KEY (store_id, market_code, currency) REFERENCES commerce.markets(store_id, code, currency) ON DELETE CASCADE;


--
-- Name: look_versions look_versions_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.look_versions
    ADD CONSTRAINT look_versions_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: look_versions look_versions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.look_versions
    ADD CONSTRAINT look_versions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: market_availability market_availability_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_availability
    ADD CONSTRAINT market_availability_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code) ON DELETE CASCADE;


--
-- Name: market_availability market_availability_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_availability
    ADD CONSTRAINT market_availability_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: market_availability market_availability_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_availability
    ADD CONSTRAINT market_availability_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: market_price_rules market_price_rules_base_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_price_rules
    ADD CONSTRAINT market_price_rules_base_fk FOREIGN KEY (store_id, base_market) REFERENCES commerce.markets(store_id, code) ON DELETE CASCADE;


--
-- Name: market_price_rules market_price_rules_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.market_price_rules
    ADD CONSTRAINT market_price_rules_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code) ON DELETE CASCADE;


--
-- Name: marketing_consent_events marketing_consent_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_consent_events
    ADD CONSTRAINT marketing_consent_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: marketing_consent_events marketing_consent_events_subscriber_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_consent_events
    ADD CONSTRAINT marketing_consent_events_subscriber_fk FOREIGN KEY (store_id, subscriber_id) REFERENCES commerce.marketing_subscribers(store_id, id) ON DELETE CASCADE;


--
-- Name: marketing_spend marketing_spend_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_spend
    ADD CONSTRAINT marketing_spend_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: marketing_subscribers marketing_subscribers_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_subscribers
    ADD CONSTRAINT marketing_subscribers_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id);


--
-- Name: marketing_subscribers marketing_subscribers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketing_subscribers
    ADD CONSTRAINT marketing_subscribers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: marketplace_connections marketplace_connections_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_connections
    ADD CONSTRAINT marketplace_connections_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: marketplace_connections marketplace_connections_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_connections
    ADD CONSTRAINT marketplace_connections_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: marketplace_listings marketplace_listings_connection_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_listings
    ADD CONSTRAINT marketplace_listings_connection_fk FOREIGN KEY (store_id, connection_id) REFERENCES commerce.marketplace_connections(store_id, id) ON DELETE CASCADE;


--
-- Name: marketplace_listings marketplace_listings_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_listings
    ADD CONSTRAINT marketplace_listings_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: marketplace_orders marketplace_orders_connection_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.marketplace_orders
    ADD CONSTRAINT marketplace_orders_connection_fk FOREIGN KEY (store_id, connection_id) REFERENCES commerce.marketplace_connections(store_id, id);


--
-- Name: markets markets_code_countries_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.markets
    ADD CONSTRAINT markets_code_countries_code_fk FOREIGN KEY (code) REFERENCES commerce.countries(code);


--
-- Name: markets markets_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.markets
    ADD CONSTRAINT markets_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: media media_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media
    ADD CONSTRAINT media_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: media media_edited_from_media_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media
    ADD CONSTRAINT media_edited_from_media_id_fk FOREIGN KEY (edited_from) REFERENCES commerce.media(id) ON DELETE SET NULL;


--
-- Name: media_embeddings media_embeddings_media_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media_embeddings
    ADD CONSTRAINT media_embeddings_media_id_fkey FOREIGN KEY (media_id) REFERENCES commerce.media(id) ON DELETE CASCADE;


--
-- Name: media_embeddings media_embeddings_store_id_fkey; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media_embeddings
    ADD CONSTRAINT media_embeddings_store_id_fkey FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: media media_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.media
    ADD CONSTRAINT media_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: menus menus_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.menus
    ADD CONSTRAINT menus_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: menus menus_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.menus
    ADD CONSTRAINT menus_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: menus menus_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.menus
    ADD CONSTRAINT menus_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: mollie_connections mollie_connections_connected_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.mollie_connections
    ADD CONSTRAINT mollie_connections_connected_by_accounts_id_fk FOREIGN KEY (connected_by) REFERENCES commerce.accounts(id);


--
-- Name: mollie_connections mollie_connections_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.mollie_connections
    ADD CONSTRAINT mollie_connections_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: not_found_hits not_found_hits_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.not_found_hits
    ADD CONSTRAINT not_found_hits_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: not_found_ignored not_found_ignored_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.not_found_ignored
    ADD CONSTRAINT not_found_ignored_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: not_found_ignored not_found_ignored_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.not_found_ignored
    ADD CONSTRAINT not_found_ignored_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: notification_settings notification_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.notification_settings
    ADD CONSTRAINT notification_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: notification_settings notification_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.notification_settings
    ADD CONSTRAINT notification_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: oauth_grants oauth_grants_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_grants
    ADD CONSTRAINT oauth_grants_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: oauth_grants oauth_grants_client_id_oauth_clients_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_grants
    ADD CONSTRAINT oauth_grants_client_id_oauth_clients_id_fk FOREIGN KEY (client_id) REFERENCES commerce.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_grants oauth_grants_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_grants
    ADD CONSTRAINT oauth_grants_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: oauth_store_cutoffs oauth_store_cutoffs_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_store_cutoffs
    ADD CONSTRAINT oauth_store_cutoffs_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: oauth_store_cutoffs oauth_store_cutoffs_client_id_oauth_clients_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_store_cutoffs
    ADD CONSTRAINT oauth_store_cutoffs_client_id_oauth_clients_id_fk FOREIGN KEY (client_id) REFERENCES commerce.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_store_cutoffs oauth_store_cutoffs_cut_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_store_cutoffs
    ADD CONSTRAINT oauth_store_cutoffs_cut_by_accounts_id_fk FOREIGN KEY (cut_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: oauth_store_cutoffs oauth_store_cutoffs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_store_cutoffs
    ADD CONSTRAINT oauth_store_cutoffs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: oauth_tokens oauth_tokens_grant_id_oauth_grants_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.oauth_tokens
    ADD CONSTRAINT oauth_tokens_grant_id_oauth_grants_id_fk FOREIGN KEY (grant_id) REFERENCES commerce.oauth_grants(id) ON DELETE CASCADE;


--
-- Name: old_shops old_shops_read_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.old_shops
    ADD CONSTRAINT old_shops_read_by_accounts_id_fk FOREIGN KEY (read_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: old_shops old_shops_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.old_shops
    ADD CONSTRAINT old_shops_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: order_discount_codes order_discount_codes_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_discount_codes
    ADD CONSTRAINT order_discount_codes_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: order_downloads order_downloads_file_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_downloads
    ADD CONSTRAINT order_downloads_file_fk FOREIGN KEY (store_id, file_id) REFERENCES commerce.product_files(store_id, id);


--
-- Name: order_downloads order_downloads_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_downloads
    ADD CONSTRAINT order_downloads_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: order_edit_lines order_edit_lines_edit_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edit_lines
    ADD CONSTRAINT order_edit_lines_edit_fk FOREIGN KEY (store_id, order_edit_id) REFERENCES commerce.order_edits(store_id, id) ON DELETE RESTRICT;


--
-- Name: order_edit_lines order_edit_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edit_lines
    ADD CONSTRAINT order_edit_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: order_edits order_edits_made_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edits
    ADD CONSTRAINT order_edits_made_by_accounts_id_fk FOREIGN KEY (made_by) REFERENCES commerce.accounts(id);


--
-- Name: order_edits order_edits_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edits
    ADD CONSTRAINT order_edits_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: order_edits order_edits_payment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edits
    ADD CONSTRAINT order_edits_payment_fk FOREIGN KEY (store_id, payment_id) REFERENCES commerce.payments(store_id, id);


--
-- Name: order_edits order_edits_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_edits
    ADD CONSTRAINT order_edits_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: order_events order_events_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_events
    ADD CONSTRAINT order_events_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: order_line_components order_line_components_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_line_components
    ADD CONSTRAINT order_line_components_line_fk FOREIGN KEY (store_id, order_line_id) REFERENCES commerce.order_lines(store_id, id);


--
-- Name: order_line_components order_line_components_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_line_components
    ADD CONSTRAINT order_line_components_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: order_lines order_lines_order_edit_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_lines
    ADD CONSTRAINT order_lines_order_edit_fk FOREIGN KEY (store_id, order_edit_id) REFERENCES commerce.order_edits(store_id, id) ON DELETE RESTRICT;


--
-- Name: order_lines order_lines_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_lines
    ADD CONSTRAINT order_lines_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: order_lines order_lines_selling_plan_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_lines
    ADD CONSTRAINT order_lines_selling_plan_fk FOREIGN KEY (store_id, selling_plan_id) REFERENCES commerce.selling_plans(store_id, id);


--
-- Name: order_lines order_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_lines
    ADD CONSTRAINT order_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: order_payment_terms order_payment_terms_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_payment_terms
    ADD CONSTRAINT order_payment_terms_company_fk FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies(store_id, id);


--
-- Name: order_payment_terms order_payment_terms_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_payment_terms
    ADD CONSTRAINT order_payment_terms_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: order_payment_terms order_payment_terms_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_payment_terms
    ADD CONSTRAINT order_payment_terms_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: order_rule_runs order_rule_runs_event_id_store_events_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rule_runs
    ADD CONSTRAINT order_rule_runs_event_id_store_events_id_fk FOREIGN KEY (event_id) REFERENCES commerce.store_events(id) ON DELETE SET NULL;


--
-- Name: order_rule_runs order_rule_runs_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rule_runs
    ADD CONSTRAINT order_rule_runs_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: order_rules order_rules_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rules
    ADD CONSTRAINT order_rules_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: order_rules order_rules_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rules
    ADD CONSTRAINT order_rules_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: order_rules order_rules_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_rules
    ADD CONSTRAINT order_rules_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: order_settings order_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_settings
    ADD CONSTRAINT order_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: order_tags order_tags_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_tags
    ADD CONSTRAINT order_tags_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: order_tags order_tags_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_tags
    ADD CONSTRAINT order_tags_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: order_terms order_terms_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_terms
    ADD CONSTRAINT order_terms_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: order_terms order_terms_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_terms
    ADD CONSTRAINT order_terms_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: order_views order_views_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_views
    ADD CONSTRAINT order_views_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: order_views order_views_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.order_views
    ADD CONSTRAINT order_views_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: orders orders_cart_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_cart_fk FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts(store_id, id);


--
-- Name: orders orders_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id);


--
-- Name: orders orders_discount_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_discount_code_fk FOREIGN KEY (store_id, discount_code_id) REFERENCES commerce.discount_codes(store_id, id) ON DELETE SET NULL (discount_code_id);


--
-- Name: orders orders_exchange_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_exchange_fk FOREIGN KEY (store_id, exchange_id) REFERENCES commerce.return_exchanges(store_id, id) ON DELETE RESTRICT;


--
-- Name: orders orders_held_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_held_by_accounts_id_fk FOREIGN KEY (held_by) REFERENCES commerce.accounts(id);


--
-- Name: orders orders_host_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_host_fk FOREIGN KEY (store_id, host_id) REFERENCES commerce.hosts(store_id, id);


--
-- Name: orders orders_made_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_made_by_accounts_id_fk FOREIGN KEY (made_by) REFERENCES commerce.accounts(id);


--
-- Name: orders orders_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code);


--
-- Name: orders orders_subscription_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_subscription_fk FOREIGN KEY (store_id, subscription_id) REFERENCES commerce.subscriptions(store_id, id);


--
-- Name: orders orders_vat_check_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.orders
    ADD CONSTRAINT orders_vat_check_fk FOREIGN KEY (store_id, vat_check_id) REFERENCES commerce.vat_checks(store_id, id) ON DELETE RESTRICT;


--
-- Name: page_ai_jobs page_ai_jobs_asked_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_ai_jobs
    ADD CONSTRAINT page_ai_jobs_asked_by_accounts_id_fk FOREIGN KEY (asked_by) REFERENCES commerce.accounts(id);


--
-- Name: page_ai_jobs page_ai_jobs_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_ai_jobs
    ADD CONSTRAINT page_ai_jobs_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: page_ai_jobs page_ai_jobs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_ai_jobs
    ADD CONSTRAINT page_ai_jobs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: page_looks page_looks_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_looks
    ADD CONSTRAINT page_looks_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: page_looks page_looks_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_looks
    ADD CONSTRAINT page_looks_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: page_looks page_looks_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_looks
    ADD CONSTRAINT page_looks_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: page_redirects page_redirects_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_redirects
    ADD CONSTRAINT page_redirects_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: page_redirects page_redirects_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_redirects
    ADD CONSTRAINT page_redirects_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: page_replications page_replications_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_replications
    ADD CONSTRAINT page_replications_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: page_replications page_replications_requested_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_replications
    ADD CONSTRAINT page_replications_requested_by_accounts_id_fk FOREIGN KEY (requested_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: page_replications page_replications_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_replications
    ADD CONSTRAINT page_replications_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: page_roles page_roles_page_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_roles
    ADD CONSTRAINT page_roles_page_fk FOREIGN KEY (store_id, page_id) REFERENCES commerce.pages(store_id, id) ON DELETE CASCADE;


--
-- Name: page_roles page_roles_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_roles
    ADD CONSTRAINT page_roles_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: page_schedules page_schedules_page_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_schedules
    ADD CONSTRAINT page_schedules_page_fk FOREIGN KEY (store_id, page_id) REFERENCES commerce.pages(store_id, id) ON DELETE CASCADE;


--
-- Name: page_schedules page_schedules_scheduled_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_schedules
    ADD CONSTRAINT page_schedules_scheduled_by_accounts_id_fk FOREIGN KEY (scheduled_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: page_schedules page_schedules_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_schedules
    ADD CONSTRAINT page_schedules_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: page_theme_detaches page_theme_detaches_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_theme_detaches
    ADD CONSTRAINT page_theme_detaches_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: page_theme_detaches page_theme_detaches_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_theme_detaches
    ADD CONSTRAINT page_theme_detaches_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: page_theme_detaches page_theme_detaches_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_theme_detaches
    ADD CONSTRAINT page_theme_detaches_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: page_versions page_versions_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_versions
    ADD CONSTRAINT page_versions_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: page_versions page_versions_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_versions
    ADD CONSTRAINT page_versions_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: page_versions page_versions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.page_versions
    ADD CONSTRAINT page_versions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: pages pages_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pages
    ADD CONSTRAINT pages_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: pages pages_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pages
    ADD CONSTRAINT pages_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: pages pages_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pages
    ADD CONSTRAINT pages_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: payment_credentials payment_credentials_provider_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_credentials
    ADD CONSTRAINT payment_credentials_provider_fk FOREIGN KEY (store_id, provider) REFERENCES commerce.payment_providers(store_id, provider);


--
-- Name: payment_credentials payment_credentials_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_credentials
    ADD CONSTRAINT payment_credentials_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: payment_disputes payment_disputes_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_disputes
    ADD CONSTRAINT payment_disputes_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: payment_disputes payment_disputes_payment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_disputes
    ADD CONSTRAINT payment_disputes_payment_fk FOREIGN KEY (store_id, payment_id) REFERENCES commerce.payments(store_id, id);


--
-- Name: payment_methods payment_methods_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_methods
    ADD CONSTRAINT payment_methods_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code);


--
-- Name: payment_methods payment_methods_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_methods
    ADD CONSTRAINT payment_methods_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: payment_providers payment_providers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_providers
    ADD CONSTRAINT payment_providers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: payment_providers payment_providers_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payment_providers
    ADD CONSTRAINT payment_providers_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: payments payments_exchange_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_exchange_fk FOREIGN KEY (store_id, exchange_id) REFERENCES commerce.return_exchanges(store_id, id);


--
-- Name: payments payments_gift_card_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_gift_card_fk FOREIGN KEY (store_id, gift_card_id) REFERENCES commerce.gift_cards(store_id, id);


--
-- Name: payments payments_order_edit_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_order_edit_fk FOREIGN KEY (store_id, order_edit_id) REFERENCES commerce.order_edits(store_id, id);


--
-- Name: payments payments_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: payments payments_recorded_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_recorded_by_accounts_id_fk FOREIGN KEY (recorded_by) REFERENCES commerce.accounts(id);


--
-- Name: payments payments_transfer_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payments
    ADD CONSTRAINT payments_transfer_refund_fk FOREIGN KEY (store_id, transfer_refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: payout_lines payout_lines_dispute_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_lines
    ADD CONSTRAINT payout_lines_dispute_fk FOREIGN KEY (store_id, dispute_id) REFERENCES commerce.payment_disputes(store_id, id);


--
-- Name: payout_lines payout_lines_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_lines
    ADD CONSTRAINT payout_lines_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: payout_lines payout_lines_payment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_lines
    ADD CONSTRAINT payout_lines_payment_fk FOREIGN KEY (store_id, payment_id) REFERENCES commerce.payments(store_id, id);


--
-- Name: payout_lines payout_lines_payout_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_lines
    ADD CONSTRAINT payout_lines_payout_fk FOREIGN KEY (store_id, payout_id) REFERENCES commerce.payouts(store_id, id);


--
-- Name: payout_lines payout_lines_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_lines
    ADD CONSTRAINT payout_lines_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: payout_reads payout_reads_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.payout_reads
    ADD CONSTRAINT payout_reads_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: pickup_options pickup_options_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pickup_options
    ADD CONSTRAINT pickup_options_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.store_locations(store_id, id) ON DELETE CASCADE;


--
-- Name: pickup_options pickup_options_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.pickup_options
    ADD CONSTRAINT pickup_options_market_fk FOREIGN KEY (store_id, market_code, currency) REFERENCES commerce.markets(store_id, code, currency) ON DELETE CASCADE;


--
-- Name: plan_feature_grants plan_feature_grants_feature_id_plan_features_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_feature_grants
    ADD CONSTRAINT plan_feature_grants_feature_id_plan_features_id_fk FOREIGN KEY (feature_id) REFERENCES commerce.plan_features(id) ON DELETE CASCADE;


--
-- Name: plan_feature_grants plan_feature_grants_plan_id_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_feature_grants
    ADD CONSTRAINT plan_feature_grants_plan_id_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.plans(id) ON DELETE CASCADE;


--
-- Name: plan_features plan_features_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_features
    ADD CONSTRAINT plan_features_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: plan_limits plan_limits_plan_id_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_limits
    ADD CONSTRAINT plan_limits_plan_id_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.plans(id) ON DELETE CASCADE;


--
-- Name: plan_limits plan_limits_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_limits
    ADD CONSTRAINT plan_limits_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: plan_moves plan_moves_plan_id_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_moves
    ADD CONSTRAINT plan_moves_plan_id_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.plans(id) ON DELETE SET NULL;


--
-- Name: plan_moves plan_moves_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_moves
    ADD CONSTRAINT plan_moves_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: plan_prices plan_prices_plan_id_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_prices
    ADD CONSTRAINT plan_prices_plan_id_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.plans(id);


--
-- Name: plan_reminder_steps plan_reminder_steps_platform_discount_id_platform_discount_code; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plan_reminder_steps
    ADD CONSTRAINT plan_reminder_steps_platform_discount_id_platform_discount_code FOREIGN KEY (platform_discount_id) REFERENCES commerce.platform_discount_codes(id) ON DELETE SET NULL;


--
-- Name: plans plans_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.plans
    ADD CONSTRAINT plans_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: platform_ad_conversions platform_ad_conversions_request_id_access_requests_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_ad_conversions
    ADD CONSTRAINT platform_ad_conversions_request_id_access_requests_id_fk FOREIGN KEY (request_id) REFERENCES commerce.access_requests(id) ON DELETE CASCADE;


--
-- Name: platform_api_tokens platform_api_tokens_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_api_tokens
    ADD CONSTRAINT platform_api_tokens_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_integration_deliveries platform_deliveries_endpoint_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_integration_deliveries
    ADD CONSTRAINT platform_deliveries_endpoint_fk FOREIGN KEY (endpoint_id) REFERENCES commerce.platform_webhook_endpoints(id) ON DELETE CASCADE;


--
-- Name: platform_discount_codes platform_discount_codes_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_discount_codes
    ADD CONSTRAINT platform_discount_codes_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: platform_integrations platform_integrations_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_integrations
    ADD CONSTRAINT platform_integrations_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_marketing_spend platform_marketing_spend_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_marketing_spend
    ADD CONSTRAINT platform_marketing_spend_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_page_roles platform_page_roles_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_page_roles
    ADD CONSTRAINT platform_page_roles_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: platform_page_roles platform_page_roles_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_page_roles
    ADD CONSTRAINT platform_page_roles_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: platform_payout_lines platform_payout_lines_payout_id_platform_payouts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_payout_lines
    ADD CONSTRAINT platform_payout_lines_payout_id_platform_payouts_id_fk FOREIGN KEY (payout_id) REFERENCES commerce.platform_payouts(id) ON DELETE CASCADE;


--
-- Name: platform_payout_lines platform_payout_lines_sale_id_platform_sales_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_payout_lines
    ADD CONSTRAINT platform_payout_lines_sale_id_platform_sales_id_fk FOREIGN KEY (sale_id) REFERENCES commerce.platform_sales(id) ON DELETE SET NULL;


--
-- Name: platform_sales platform_sales_buyer_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_sales
    ADD CONSTRAINT platform_sales_buyer_store_id_stores_id_fk FOREIGN KEY (buyer_store_id) REFERENCES commerce.stores(id) ON DELETE SET NULL;


--
-- Name: platform_settings platform_settings_books_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_books_store_id_stores_id_fk FOREIGN KEY (books_store_id) REFERENCES commerce.stores(id) ON DELETE SET NULL;


--
-- Name: platform_settings platform_settings_footer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_footer_fk FOREIGN KEY (footer_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: platform_settings platform_settings_footer_menu_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_footer_menu_fk FOREIGN KEY (footer_menu_id) REFERENCES commerce.menus(id) ON DELETE SET NULL;


--
-- Name: platform_settings platform_settings_header_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_header_fk FOREIGN KEY (header_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: platform_settings platform_settings_header_menu_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_header_menu_fk FOREIGN KEY (header_menu_id) REFERENCES commerce.menus(id) ON DELETE SET NULL;


--
-- Name: platform_settings platform_settings_sandbox_source_store_starters_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_sandbox_source_store_starters_id_fk FOREIGN KEY (sandbox_source) REFERENCES commerce.store_starters(id) ON DELETE SET NULL;


--
-- Name: platform_settings platform_settings_site_from_store_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_site_from_store_by_accounts_id_fk FOREIGN KEY (site_from_store_by) REFERENCES commerce.accounts(id);


--
-- Name: platform_settings platform_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_settings
    ADD CONSTRAINT platform_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: platform_targets platform_targets_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_targets
    ADD CONSTRAINT platform_targets_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_theme_install_updates platform_theme_install_updates_from_version_id_design_preset_ve; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_install_updates
    ADD CONSTRAINT platform_theme_install_updates_from_version_id_design_preset_ve FOREIGN KEY (from_version_id) REFERENCES commerce.design_preset_versions(id) ON DELETE SET NULL;


--
-- Name: platform_theme_install_updates platform_theme_install_updates_install_id_platform_theme_instal; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_install_updates
    ADD CONSTRAINT platform_theme_install_updates_install_id_platform_theme_instal FOREIGN KEY (install_id) REFERENCES commerce.platform_theme_installs(id) ON DELETE CASCADE;


--
-- Name: platform_theme_install_updates platform_theme_install_updates_to_version_id_design_preset_vers; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_install_updates
    ADD CONSTRAINT platform_theme_install_updates_to_version_id_design_preset_vers FOREIGN KEY (to_version_id) REFERENCES commerce.design_preset_versions(id) ON DELETE SET NULL;


--
-- Name: platform_theme_install_updates platform_theme_install_updates_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_install_updates
    ADD CONSTRAINT platform_theme_install_updates_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_theme_installs platform_theme_installs_installed_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_installs
    ADD CONSTRAINT platform_theme_installs_installed_by_accounts_id_fk FOREIGN KEY (installed_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_theme_installs platform_theme_installs_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_installs
    ADD CONSTRAINT platform_theme_installs_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id);


--
-- Name: platform_theme_installs platform_theme_installs_version_id_design_preset_versions_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_theme_installs
    ADD CONSTRAINT platform_theme_installs_version_id_design_preset_versions_id_fk FOREIGN KEY (version_id) REFERENCES commerce.design_preset_versions(id);


--
-- Name: platform_webhook_endpoints platform_webhook_endpoints_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_webhook_endpoints
    ADD CONSTRAINT platform_webhook_endpoints_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_webhooks platform_webhooks_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_webhooks
    ADD CONSTRAINT platform_webhooks_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: platform_workflow_runs platform_workflow_runs_workflow_id_platform_workflows_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_workflow_runs
    ADD CONSTRAINT platform_workflow_runs_workflow_id_platform_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES commerce.platform_workflows(id) ON DELETE CASCADE;


--
-- Name: platform_workflows platform_workflows_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_workflows
    ADD CONSTRAINT platform_workflows_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: platform_workflows platform_workflows_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.platform_workflows
    ADD CONSTRAINT platform_workflows_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: preview_links preview_links_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.preview_links
    ADD CONSTRAINT preview_links_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: preview_links preview_links_install_id_store_theme_installs_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.preview_links
    ADD CONSTRAINT preview_links_install_id_store_theme_installs_id_fk FOREIGN KEY (install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE CASCADE;


--
-- Name: preview_links preview_links_page_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.preview_links
    ADD CONSTRAINT preview_links_page_fk FOREIGN KEY (store_id, page_id) REFERENCES commerce.pages(store_id, id) ON DELETE CASCADE;


--
-- Name: preview_links preview_links_revoked_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.preview_links
    ADD CONSTRAINT preview_links_revoked_by_accounts_id_fk FOREIGN KEY (revoked_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: preview_links preview_links_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.preview_links
    ADD CONSTRAINT preview_links_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: price_breaks price_breaks_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_breaks
    ADD CONSTRAINT price_breaks_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: price_breaks price_breaks_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_breaks
    ADD CONSTRAINT price_breaks_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_assignments price_list_assignments_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_assignments
    ADD CONSTRAINT price_list_assignments_company_fk FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_assignments price_list_assignments_list_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_assignments
    ADD CONSTRAINT price_list_assignments_list_fk FOREIGN KEY (store_id, list_id) REFERENCES commerce.price_lists(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_assignments price_list_assignments_tier_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_assignments
    ADD CONSTRAINT price_list_assignments_tier_fk FOREIGN KEY (store_id, tier_id) REFERENCES commerce.customer_tiers(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_breaks price_list_breaks_list_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_breaks
    ADD CONSTRAINT price_list_breaks_list_fk FOREIGN KEY (store_id, list_id) REFERENCES commerce.price_lists(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_breaks price_list_breaks_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_breaks
    ADD CONSTRAINT price_list_breaks_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_prices price_list_prices_list_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_prices
    ADD CONSTRAINT price_list_prices_list_fk FOREIGN KEY (store_id, list_id) REFERENCES commerce.price_lists(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_prices price_list_prices_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_prices
    ADD CONSTRAINT price_list_prices_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_products price_list_products_list_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_products
    ADD CONSTRAINT price_list_products_list_fk FOREIGN KEY (store_id, list_id) REFERENCES commerce.price_lists(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_products price_list_products_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_products
    ADD CONSTRAINT price_list_products_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_products price_list_products_term_id_terms_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_products
    ADD CONSTRAINT price_list_products_term_id_terms_id_fk FOREIGN KEY (term_id) REFERENCES commerce.terms(id) ON DELETE CASCADE;


--
-- Name: price_list_quantity_rules price_list_quantity_rules_list_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_quantity_rules
    ADD CONSTRAINT price_list_quantity_rules_list_fk FOREIGN KEY (store_id, list_id) REFERENCES commerce.price_lists(store_id, id) ON DELETE CASCADE;


--
-- Name: price_list_quantity_rules price_list_quantity_rules_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_list_quantity_rules
    ADD CONSTRAINT price_list_quantity_rules_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: price_lists price_lists_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.price_lists
    ADD CONSTRAINT price_lists_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: prices prices_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.prices
    ADD CONSTRAINT prices_market_fk FOREIGN KEY (store_id, market_code, currency) REFERENCES commerce.markets(store_id, code, currency);


--
-- Name: prices prices_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.prices
    ADD CONSTRAINT prices_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: privacy_requests privacy_requests_handled_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.privacy_requests
    ADD CONSTRAINT privacy_requests_handled_by_accounts_id_fk FOREIGN KEY (handled_by) REFERENCES commerce.accounts(id);


--
-- Name: privacy_requests privacy_requests_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.privacy_requests
    ADD CONSTRAINT privacy_requests_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: producer_registrations producer_registrations_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.producer_registrations
    ADD CONSTRAINT producer_registrations_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code);


--
-- Name: product_embeddings product_embeddings_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_embeddings
    ADD CONSTRAINT product_embeddings_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_embeddings product_embeddings_translation_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_embeddings
    ADD CONSTRAINT product_embeddings_translation_fk FOREIGN KEY (product_id, locale) REFERENCES commerce.product_translations(product_id, locale) ON DELETE CASCADE;


--
-- Name: product_files product_files_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_files
    ADD CONSTRAINT product_files_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_files product_files_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_files
    ADD CONSTRAINT product_files_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: product_groups product_groups_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_groups
    ADD CONSTRAINT product_groups_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: product_market_texts product_market_texts_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_market_texts
    ADD CONSTRAINT product_market_texts_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code) ON DELETE CASCADE;


--
-- Name: product_market_texts product_market_texts_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_market_texts
    ADD CONSTRAINT product_market_texts_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_media product_media_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_media
    ADD CONSTRAINT product_media_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_passports product_passports_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_passports
    ADD CONSTRAINT product_passports_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_passports product_passports_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_passports
    ADD CONSTRAINT product_passports_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: product_resources product_resources_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_resources
    ADD CONSTRAINT product_resources_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_resources product_resources_resource_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_resources
    ADD CONSTRAINT product_resources_resource_fk FOREIGN KEY (store_id, resource_id) REFERENCES commerce.booking_resources(store_id, id) ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_answered_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_answered_by_accounts_id_fk FOREIGN KEY (answered_by) REFERENCES commerce.accounts(id);


--
-- Name: product_reviews product_reviews_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_moderated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_moderated_by_accounts_id_fk FOREIGN KEY (moderated_by) REFERENCES commerce.accounts(id);


--
-- Name: product_reviews product_reviews_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: product_reviews product_reviews_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: product_reviews product_reviews_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_reviews
    ADD CONSTRAINT product_reviews_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: product_schemes product_schemes_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_schemes
    ADD CONSTRAINT product_schemes_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_settings product_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_settings
    ADD CONSTRAINT product_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: product_terms product_terms_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_terms
    ADD CONSTRAINT product_terms_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_terms product_terms_term_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_terms
    ADD CONSTRAINT product_terms_term_fk FOREIGN KEY (store_id, content_type, term_id) REFERENCES commerce.terms(store_id, content_type, id) ON DELETE CASCADE;


--
-- Name: product_translations product_translations_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_translations
    ADD CONSTRAINT product_translations_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_variants
    ADD CONSTRAINT product_variants_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_supplier_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_variants
    ADD CONSTRAINT product_variants_supplier_fk FOREIGN KEY (store_id, supplier_id) REFERENCES commerce.suppliers(store_id, id);


--
-- Name: product_views product_views_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_views
    ADD CONSTRAINT product_views_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: product_views product_views_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.product_views
    ADD CONSTRAINT product_views_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: products products_group_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_group_fk FOREIGN KEY (store_id, group_id) REFERENCES commerce.product_groups(store_id, id);


--
-- Name: products products_host_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_host_fk FOREIGN KEY (store_id, host_id) REFERENCES commerce.hosts(store_id, id);


--
-- Name: products products_manufacturer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_manufacturer_fk FOREIGN KEY (store_id, manufacturer_id) REFERENCES commerce.economic_operators(store_id, id);


--
-- Name: products products_product_layout_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_product_layout_fk FOREIGN KEY (store_id, product_layout_id) REFERENCES commerce.pages(store_id, id) ON DELETE SET NULL (product_layout_id);


--
-- Name: products products_responsible_person_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_responsible_person_fk FOREIGN KEY (store_id, responsible_person_id) REFERENCES commerce.economic_operators(store_id, id);


--
-- Name: products products_shipping_profile_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_shipping_profile_fk FOREIGN KEY (store_id, shipping_profile_id) REFERENCES commerce.shipping_profiles(store_id, id);


--
-- Name: products products_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: products products_vat_category_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.products
    ADD CONSTRAINT products_vat_category_fk FOREIGN KEY (vat_category) REFERENCES commerce.vat_categories(code);


--
-- Name: purchase_order_lines purchase_order_lines_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_order_fk FOREIGN KEY (store_id, purchase_order_id) REFERENCES commerce.purchase_orders(store_id, id) ON DELETE CASCADE;


--
-- Name: purchase_order_lines purchase_order_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: purchase_orders purchase_orders_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.purchase_orders
    ADD CONSTRAINT purchase_orders_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_location_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.purchase_orders
    ADD CONSTRAINT purchase_orders_location_fk FOREIGN KEY (store_id, location_id) REFERENCES commerce.inventory_locations(store_id, id);


--
-- Name: push_subscriptions push_subscriptions_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.push_subscriptions
    ADD CONSTRAINT push_subscriptions_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.push_subscriptions
    ADD CONSTRAINT push_subscriptions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: recommendation_adds recommendation_adds_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_adds
    ADD CONSTRAINT recommendation_adds_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: recommendation_events recommendation_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_events
    ADD CONSTRAINT recommendation_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: recommendation_rules recommendation_rules_other_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_rules
    ADD CONSTRAINT recommendation_rules_other_fk FOREIGN KEY (store_id, other_product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: recommendation_rules recommendation_rules_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_rules
    ADD CONSTRAINT recommendation_rules_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: recommendation_rules recommendation_rules_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_rules
    ADD CONSTRAINT recommendation_rules_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: recommendation_settings recommendation_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_settings
    ADD CONSTRAINT recommendation_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: recommendation_settings recommendation_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recommendation_settings
    ADD CONSTRAINT recommendation_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: recurring_costs recurring_costs_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recurring_costs
    ADD CONSTRAINT recurring_costs_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: recurring_costs recurring_costs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.recurring_costs
    ADD CONSTRAINT recurring_costs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: redirects redirects_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: redirects redirects_entry_id_content_entries_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_entry_id_content_entries_id_fk FOREIGN KEY (entry_id) REFERENCES commerce.content_entries(id) ON DELETE CASCADE;


--
-- Name: redirects redirects_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: redirects redirects_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: redirects redirects_term_id_terms_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.redirects
    ADD CONSTRAINT redirects_term_id_terms_id_fk FOREIGN KEY (term_id) REFERENCES commerce.terms(id) ON DELETE CASCADE;


--
-- Name: referral_allocations referral_allocations_entry_id_referral_entries_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_allocations
    ADD CONSTRAINT referral_allocations_entry_id_referral_entries_id_fk FOREIGN KEY (entry_id) REFERENCES commerce.referral_entries(id) ON DELETE CASCADE;


--
-- Name: referral_allocations referral_allocations_lot_id_referral_entries_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_allocations
    ADD CONSTRAINT referral_allocations_lot_id_referral_entries_id_fk FOREIGN KEY (lot_id) REFERENCES commerce.referral_entries(id) ON DELETE CASCADE;


--
-- Name: referral_entries referral_entries_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_entries
    ADD CONSTRAINT referral_entries_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: referral_entries referral_entries_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_entries
    ADD CONSTRAINT referral_entries_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: referral_entries referral_entries_referral_id_referrals_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_entries
    ADD CONSTRAINT referral_entries_referral_id_referrals_id_fk FOREIGN KEY (referral_id) REFERENCES commerce.referrals(id);


--
-- Name: referral_settings referral_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_settings
    ADD CONSTRAINT referral_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: referral_visits referral_visits_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referral_visits
    ADD CONSTRAINT referral_visits_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: referrals referrals_access_request_id_access_requests_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrals
    ADD CONSTRAINT referrals_access_request_id_access_requests_id_fk FOREIGN KEY (access_request_id) REFERENCES commerce.access_requests(id);


--
-- Name: referrals referrals_referrer_account_id_referrers_account_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrals
    ADD CONSTRAINT referrals_referrer_account_id_referrers_account_id_fk FOREIGN KEY (referrer_account_id) REFERENCES commerce.referrers(account_id) ON DELETE CASCADE;


--
-- Name: referrals referrals_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrals
    ADD CONSTRAINT referrals_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: referrers referrers_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.referrers
    ADD CONSTRAINT referrers_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: refunds refunds_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: refunds refunds_exchange_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_exchange_fk FOREIGN KEY (store_id, exchange_id) REFERENCES commerce.return_exchanges(store_id, id);


--
-- Name: refunds refunds_order_edit_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_order_edit_fk FOREIGN KEY (store_id, order_edit_id) REFERENCES commerce.order_edits(store_id, id);


--
-- Name: refunds refunds_payment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.refunds
    ADD CONSTRAINT refunds_payment_fk FOREIGN KEY (store_id, payment_id) REFERENCES commerce.payments(store_id, id);


--
-- Name: report_schedules report_schedules_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.report_schedules
    ADD CONSTRAINT report_schedules_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: report_schedules report_schedules_report_id_saved_reports_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.report_schedules
    ADD CONSTRAINT report_schedules_report_id_saved_reports_id_fk FOREIGN KEY (report_id) REFERENCES commerce.saved_reports(id) ON DELETE CASCADE;


--
-- Name: report_schedules report_schedules_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.report_schedules
    ADD CONSTRAINT report_schedules_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: report_schedules report_schedules_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.report_schedules
    ADD CONSTRAINT report_schedules_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: research_notes research_notes_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.research_notes
    ADD CONSTRAINT research_notes_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: research_notes research_notes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.research_notes
    ADD CONSTRAINT research_notes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: research_sources research_sources_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.research_sources
    ADD CONSTRAINT research_sources_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: research_sources research_sources_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.research_sources
    ADD CONSTRAINT research_sources_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: resource_blocks resource_blocks_feed_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.resource_blocks
    ADD CONSTRAINT resource_blocks_feed_fk FOREIGN KEY (store_id, feed_id) REFERENCES commerce.calendar_feeds(store_id, id) ON DELETE CASCADE;


--
-- Name: resource_blocks resource_blocks_resource_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.resource_blocks
    ADD CONSTRAINT resource_blocks_resource_fk FOREIGN KEY (store_id, resource_id) REFERENCES commerce.booking_resources(store_id, id) ON DELETE CASCADE;


--
-- Name: resource_blocks resource_blocks_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.resource_blocks
    ADD CONSTRAINT resource_blocks_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: retention_rules retention_rules_country_countries_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.retention_rules
    ADD CONSTRAINT retention_rules_country_countries_code_fk FOREIGN KEY (country) REFERENCES commerce.countries(code);


--
-- Name: retention_rules retention_rules_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.retention_rules
    ADD CONSTRAINT retention_rules_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: retention_rules retention_rules_verified_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.retention_rules
    ADD CONSTRAINT retention_rules_verified_by_accounts_id_fk FOREIGN KEY (verified_by) REFERENCES commerce.accounts(id);


--
-- Name: return_exchange_lines return_exchange_lines_exchange_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchange_lines
    ADD CONSTRAINT return_exchange_lines_exchange_fk FOREIGN KEY (store_id, exchange_id) REFERENCES commerce.return_exchanges(store_id, id) ON DELETE RESTRICT;


--
-- Name: return_exchange_lines return_exchange_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchange_lines
    ADD CONSTRAINT return_exchange_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE RESTRICT;


--
-- Name: return_exchanges return_exchanges_exchange_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_exchange_order_fk FOREIGN KEY (store_id, exchange_order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: return_exchanges return_exchanges_made_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_made_by_accounts_id_fk FOREIGN KEY (made_by) REFERENCES commerce.accounts(id);


--
-- Name: return_exchanges return_exchanges_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: return_exchanges return_exchanges_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: return_exchanges return_exchanges_return_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_return_fk FOREIGN KEY (store_id, return_id) REFERENCES commerce.returns(store_id, id) ON DELETE RESTRICT;


--
-- Name: return_exchanges return_exchanges_transfer_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_exchanges
    ADD CONSTRAINT return_exchanges_transfer_refund_fk FOREIGN KEY (store_id, transfer_refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: return_lines return_lines_order_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_lines
    ADD CONSTRAINT return_lines_order_line_fk FOREIGN KEY (store_id, order_line_id) REFERENCES commerce.order_lines(store_id, id);


--
-- Name: return_lines return_lines_return_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_lines
    ADD CONSTRAINT return_lines_return_fk FOREIGN KEY (store_id, return_id) REFERENCES commerce.returns(store_id, id) ON DELETE CASCADE;


--
-- Name: return_settings return_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_settings
    ADD CONSTRAINT return_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: return_settings return_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.return_settings
    ADD CONSTRAINT return_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: returns returns_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.returns
    ADD CONSTRAINT returns_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: returns returns_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.returns
    ADD CONSTRAINT returns_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id);


--
-- Name: returns returns_withdrawal_request_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.returns
    ADD CONSTRAINT returns_withdrawal_request_fk FOREIGN KEY (store_id, withdrawal_request_id) REFERENCES commerce.withdrawal_requests(store_id, id);


--
-- Name: review_pictures review_pictures_hidden_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_pictures
    ADD CONSTRAINT review_pictures_hidden_by_accounts_id_fk FOREIGN KEY (hidden_by) REFERENCES commerce.accounts(id);


--
-- Name: review_pictures review_pictures_review_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_pictures
    ADD CONSTRAINT review_pictures_review_fk FOREIGN KEY (store_id, review_id) REFERENCES commerce.product_reviews(store_id, id) ON DELETE CASCADE;


--
-- Name: review_pictures review_pictures_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_pictures
    ADD CONSTRAINT review_pictures_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: review_requests review_requests_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_requests
    ADD CONSTRAINT review_requests_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: review_requests review_requests_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_requests
    ADD CONSTRAINT review_requests_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: review_settings review_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.review_settings
    ADD CONSTRAINT review_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: sandboxes sandboxes_source_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sandboxes
    ADD CONSTRAINT sandboxes_source_store_id_stores_id_fk FOREIGN KEY (source_store_id) REFERENCES commerce.stores(id);


--
-- Name: sandboxes sandboxes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sandboxes
    ADD CONSTRAINT sandboxes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: saved_parts saved_parts_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_parts
    ADD CONSTRAINT saved_parts_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: saved_parts saved_parts_hidden_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_parts
    ADD CONSTRAINT saved_parts_hidden_by_accounts_id_fk FOREIGN KEY (hidden_by) REFERENCES commerce.accounts(id);


--
-- Name: saved_parts saved_parts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_parts
    ADD CONSTRAINT saved_parts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: saved_parts saved_parts_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_parts
    ADD CONSTRAINT saved_parts_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: saved_reports saved_reports_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_reports
    ADD CONSTRAINT saved_reports_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: saved_reports saved_reports_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_reports
    ADD CONSTRAINT saved_reports_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: saved_reports saved_reports_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.saved_reports
    ADD CONSTRAINT saved_reports_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: search_cache search_cache_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_cache
    ADD CONSTRAINT search_cache_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: search_clicks search_clicks_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_clicks
    ADD CONSTRAINT search_clicks_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: search_clicks search_clicks_search_id_search_queries_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_clicks
    ADD CONSTRAINT search_clicks_search_id_search_queries_id_fk FOREIGN KEY (search_id) REFERENCES commerce.search_queries(id) ON DELETE CASCADE;


--
-- Name: search_experiments search_experiments_ended_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_experiments
    ADD CONSTRAINT search_experiments_ended_by_accounts_id_fk FOREIGN KEY (ended_by) REFERENCES commerce.accounts(id);


--
-- Name: search_experiments search_experiments_started_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_experiments
    ADD CONSTRAINT search_experiments_started_by_accounts_id_fk FOREIGN KEY (started_by) REFERENCES commerce.accounts(id);


--
-- Name: search_queries search_queries_experiment_id_search_experiments_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_queries
    ADD CONSTRAINT search_queries_experiment_id_search_experiments_id_fk FOREIGN KEY (experiment_id) REFERENCES commerce.search_experiments(id);


--
-- Name: search_queries search_queries_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_queries
    ADD CONSTRAINT search_queries_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: search_queries search_queries_visit_id_visits_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_queries
    ADD CONSTRAINT search_queries_visit_id_visits_id_fk FOREIGN KEY (visit_id) REFERENCES commerce.visits(id) ON DELETE SET NULL;


--
-- Name: search_rules search_rules_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_rules
    ADD CONSTRAINT search_rules_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: search_rules search_rules_term_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_rules
    ADD CONSTRAINT search_rules_term_fk FOREIGN KEY (store_id, content_type, term_id) REFERENCES commerce.terms(store_id, content_type, id) ON DELETE CASCADE;


--
-- Name: search_settings search_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_settings
    ADD CONSTRAINT search_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: search_settings search_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_settings
    ADD CONSTRAINT search_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: search_synonyms search_synonyms_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.search_synonyms
    ADD CONSTRAINT search_synonyms_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: segments segments_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.segments
    ADD CONSTRAINT segments_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: segments segments_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.segments
    ADD CONSTRAINT segments_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: selling_plans selling_plans_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.selling_plans
    ADD CONSTRAINT selling_plans_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: shipment_lines shipment_lines_order_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipment_lines
    ADD CONSTRAINT shipment_lines_order_line_fk FOREIGN KEY (store_id, order_line_id) REFERENCES commerce.order_lines(store_id, id) ON DELETE RESTRICT;


--
-- Name: shipment_lines shipment_lines_shipment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipment_lines
    ADD CONSTRAINT shipment_lines_shipment_fk FOREIGN KEY (store_id, shipment_id) REFERENCES commerce.shipments(store_id, id) ON DELETE RESTRICT;


--
-- Name: shipment_tracking shipment_tracking_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipment_tracking
    ADD CONSTRAINT shipment_tracking_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: shipment_tracking shipment_tracking_shipment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipment_tracking
    ADD CONSTRAINT shipment_tracking_shipment_fk FOREIGN KEY (store_id, shipment_id) REFERENCES commerce.shipments(store_id, id) ON DELETE RESTRICT;


--
-- Name: shipments shipments_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipments
    ADD CONSTRAINT shipments_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: shipments shipments_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipments
    ADD CONSTRAINT shipments_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: shipments shipments_undone_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipments
    ADD CONSTRAINT shipments_undone_by_accounts_id_fk FOREIGN KEY (undone_by) REFERENCES commerce.accounts(id);


--
-- Name: shipping_carriers shipping_carriers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_carriers
    ADD CONSTRAINT shipping_carriers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: shipping_carriers shipping_carriers_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_carriers
    ADD CONSTRAINT shipping_carriers_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: shipping_method_rates shipping_method_rates_method_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_method_rates
    ADD CONSTRAINT shipping_method_rates_method_fk FOREIGN KEY (store_id, method_id) REFERENCES commerce.shipping_methods(store_id, id) ON DELETE CASCADE;


--
-- Name: shipping_method_rates shipping_method_rates_profile_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_method_rates
    ADD CONSTRAINT shipping_method_rates_profile_fk FOREIGN KEY (store_id, profile_id) REFERENCES commerce.shipping_profiles(store_id, id) ON DELETE CASCADE;


--
-- Name: shipping_method_rates shipping_method_rates_zone_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_method_rates
    ADD CONSTRAINT shipping_method_rates_zone_fk FOREIGN KEY (store_id, zone_id) REFERENCES commerce.shipping_zones(store_id, id) ON DELETE CASCADE;


--
-- Name: shipping_methods shipping_methods_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_methods
    ADD CONSTRAINT shipping_methods_market_fk FOREIGN KEY (store_id, market_code, currency) REFERENCES commerce.markets(store_id, code, currency) ON DELETE CASCADE;


--
-- Name: shipping_profiles shipping_profiles_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_profiles
    ADD CONSTRAINT shipping_profiles_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: shipping_rates shipping_rates_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_rates
    ADD CONSTRAINT shipping_rates_market_fk FOREIGN KEY (store_id, market_code, currency) REFERENCES commerce.markets(store_id, code, currency) ON DELETE CASCADE;


--
-- Name: shipping_settings shipping_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_settings
    ADD CONSTRAINT shipping_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: shipping_settings shipping_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_settings
    ADD CONSTRAINT shipping_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: shipping_vat_rules shipping_vat_rules_country_code_countries_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_vat_rules
    ADD CONSTRAINT shipping_vat_rules_country_code_countries_code_fk FOREIGN KEY (country_code) REFERENCES commerce.countries(code);


--
-- Name: shipping_vat_rules shipping_vat_rules_verified_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_vat_rules
    ADD CONSTRAINT shipping_vat_rules_verified_by_accounts_id_fk FOREIGN KEY (verified_by) REFERENCES commerce.accounts(id);


--
-- Name: shipping_zones shipping_zones_market_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shipping_zones
    ADD CONSTRAINT shipping_zones_market_fk FOREIGN KEY (store_id, market_code) REFERENCES commerce.markets(store_id, code) ON DELETE CASCADE;


--
-- Name: shop_move_items shop_move_items_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shop_move_items
    ADD CONSTRAINT shop_move_items_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: shop_moves shop_moves_connected_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shop_moves
    ADD CONSTRAINT shop_moves_connected_by_accounts_id_fk FOREIGN KEY (connected_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: shop_moves shop_moves_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.shop_moves
    ADD CONSTRAINT shop_moves_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: signup_incentives signup_incentives_discount_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.signup_incentives
    ADD CONSTRAINT signup_incentives_discount_fk FOREIGN KEY (store_id, discount_id) REFERENCES commerce.discount_codes(store_id, id) ON DELETE CASCADE;


--
-- Name: signup_incentives signup_incentives_item_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.signup_incentives
    ADD CONSTRAINT signup_incentives_item_fk FOREIGN KEY (store_id, code_item_id) REFERENCES commerce.discount_code_items(store_id, id);


--
-- Name: signup_incentives signup_incentives_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.signup_incentives
    ADD CONSTRAINT signup_incentives_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: site_staging_pages site_staging_pages_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_staging_pages
    ADD CONSTRAINT site_staging_pages_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE CASCADE;


--
-- Name: site_staging_pages site_staging_pages_staging_id_site_stagings_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_staging_pages
    ADD CONSTRAINT site_staging_pages_staging_id_site_stagings_id_fk FOREIGN KEY (staging_id) REFERENCES commerce.site_stagings(id) ON DELETE CASCADE;


--
-- Name: site_staging_pages site_staging_pages_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_staging_pages
    ADD CONSTRAINT site_staging_pages_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: site_stagings site_stagings_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_stagings
    ADD CONSTRAINT site_stagings_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: site_stagings site_stagings_install_id_store_theme_installs_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_stagings
    ADD CONSTRAINT site_stagings_install_id_store_theme_installs_id_fk FOREIGN KEY (install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE SET NULL;


--
-- Name: site_stagings site_stagings_published_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_stagings
    ADD CONSTRAINT site_stagings_published_by_accounts_id_fk FOREIGN KEY (published_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: site_stagings site_stagings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.site_stagings
    ADD CONSTRAINT site_stagings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: sms_campaigns sms_campaigns_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_campaigns
    ADD CONSTRAINT sms_campaigns_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: sms_campaigns sms_campaigns_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_campaigns
    ADD CONSTRAINT sms_campaigns_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: sms_consent_events sms_consent_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_consent_events
    ADD CONSTRAINT sms_consent_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: sms_consent_events sms_consent_events_subscriber_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_consent_events
    ADD CONSTRAINT sms_consent_events_subscriber_fk FOREIGN KEY (store_id, subscriber_id) REFERENCES commerce.sms_subscribers(store_id, id) ON DELETE CASCADE;


--
-- Name: sms_messages sms_messages_campaign_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_messages
    ADD CONSTRAINT sms_messages_campaign_fk FOREIGN KEY (store_id, campaign_id) REFERENCES commerce.sms_campaigns(store_id, id) ON DELETE CASCADE;


--
-- Name: sms_messages sms_messages_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_messages
    ADD CONSTRAINT sms_messages_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: sms_messages sms_messages_subscriber_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_messages
    ADD CONSTRAINT sms_messages_subscriber_fk FOREIGN KEY (store_id, subscriber_id) REFERENCES commerce.sms_subscribers(store_id, id) ON DELETE CASCADE;


--
-- Name: sms_settings sms_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_settings
    ADD CONSTRAINT sms_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: sms_settings sms_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_settings
    ADD CONSTRAINT sms_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: sms_subscribers sms_subscribers_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_subscribers
    ADD CONSTRAINT sms_subscribers_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id);


--
-- Name: sms_subscribers sms_subscribers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.sms_subscribers
    ADD CONSTRAINT sms_subscribers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: staff_alert_recipients staff_alert_recipients_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.staff_alert_recipients
    ADD CONSTRAINT staff_alert_recipients_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: staff_alert_recipients staff_alert_recipients_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.staff_alert_recipients
    ADD CONSTRAINT staff_alert_recipients_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: staff_alert_settings staff_alert_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.staff_alert_settings
    ADD CONSTRAINT staff_alert_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: staff_alert_settings staff_alert_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.staff_alert_settings
    ADD CONSTRAINT staff_alert_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: standing_deliveries standing_deliveries_list_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_deliveries
    ADD CONSTRAINT standing_deliveries_list_fk FOREIGN KEY (store_id, standing_order_id) REFERENCES commerce.standing_orders(store_id, id);


--
-- Name: standing_deliveries standing_deliveries_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_deliveries
    ADD CONSTRAINT standing_deliveries_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: standing_order_lines standing_order_lines_list_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_order_lines
    ADD CONSTRAINT standing_order_lines_list_fk FOREIGN KEY (store_id, standing_order_id) REFERENCES commerce.standing_orders(store_id, id) ON DELETE CASCADE;


--
-- Name: standing_order_lines standing_order_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_order_lines
    ADD CONSTRAINT standing_order_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: standing_orders standing_orders_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_orders
    ADD CONSTRAINT standing_orders_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id);


--
-- Name: standing_orders standing_orders_schedule_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_orders
    ADD CONSTRAINT standing_orders_schedule_fk FOREIGN KEY (store_id, schedule_id) REFERENCES commerce.delivery_schedules(store_id, id);


--
-- Name: standing_orders standing_orders_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.standing_orders
    ADD CONSTRAINT standing_orders_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: status_incident_updates status_incident_updates_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.status_incident_updates
    ADD CONSTRAINT status_incident_updates_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: status_incident_updates status_incident_updates_incident_id_status_incidents_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.status_incident_updates
    ADD CONSTRAINT status_incident_updates_incident_id_status_incidents_id_fk FOREIGN KEY (incident_id) REFERENCES commerce.status_incidents(id) ON DELETE CASCADE;


--
-- Name: status_incidents status_incidents_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.status_incidents
    ADD CONSTRAINT status_incidents_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: stock_alerts stock_alerts_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_alerts
    ADD CONSTRAINT stock_alerts_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: stock_requests stock_requests_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_requests
    ADD CONSTRAINT stock_requests_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: stock_requests stock_requests_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_requests
    ADD CONSTRAINT stock_requests_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: stock_requests stock_requests_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_requests
    ADD CONSTRAINT stock_requests_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: stock_requests stock_requests_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_requests
    ADD CONSTRAINT stock_requests_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE CASCADE;


--
-- Name: stock_transfer_lines stock_transfer_lines_transfer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfer_lines
    ADD CONSTRAINT stock_transfer_lines_transfer_fk FOREIGN KEY (store_id, transfer_id) REFERENCES commerce.stock_transfers(store_id, id) ON DELETE CASCADE;


--
-- Name: stock_transfer_lines stock_transfer_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfer_lines
    ADD CONSTRAINT stock_transfer_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: stock_transfers stock_transfers_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfers
    ADD CONSTRAINT stock_transfers_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: stock_transfers stock_transfers_destination_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfers
    ADD CONSTRAINT stock_transfers_destination_fk FOREIGN KEY (store_id, destination_id) REFERENCES commerce.inventory_locations(store_id, id);


--
-- Name: stock_transfers stock_transfers_origin_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stock_transfers
    ADD CONSTRAINT stock_transfers_origin_fk FOREIGN KEY (store_id, origin_id) REFERENCES commerce.inventory_locations(store_id, id);


--
-- Name: store_billing store_billing_plan_id_plans_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_plan_id_plans_id_fk FOREIGN KEY (plan_id) REFERENCES commerce.plans(id);


--
-- Name: store_billing store_billing_platform_discount_id_platform_discount_codes_id_f; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_platform_discount_id_platform_discount_codes_id_f FOREIGN KEY (platform_discount_id) REFERENCES commerce.platform_discount_codes(id) ON DELETE SET NULL;


--
-- Name: store_billing store_billing_price_id_plan_prices_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_price_id_plan_prices_id_fk FOREIGN KEY (price_id) REFERENCES commerce.plan_prices(id);


--
-- Name: store_billing store_billing_price_plan_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_price_plan_fk FOREIGN KEY (price_id, plan_id) REFERENCES commerce.plan_prices(id, plan_id);


--
-- Name: store_billing store_billing_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_billing store_billing_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_billing
    ADD CONSTRAINT store_billing_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: store_business_changes store_business_changes_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_business_changes
    ADD CONSTRAINT store_business_changes_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: store_business_changes store_business_changes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_business_changes
    ADD CONSTRAINT store_business_changes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_copies store_copies_new_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_copies
    ADD CONSTRAINT store_copies_new_store_id_stores_id_fk FOREIGN KEY (new_store_id) REFERENCES commerce.stores(id);


--
-- Name: store_copies store_copies_requested_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_copies
    ADD CONSTRAINT store_copies_requested_by_accounts_id_fk FOREIGN KEY (requested_by) REFERENCES commerce.accounts(id);


--
-- Name: store_copies store_copies_source_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_copies
    ADD CONSTRAINT store_copies_source_store_id_stores_id_fk FOREIGN KEY (source_store_id) REFERENCES commerce.stores(id);


--
-- Name: store_copy_files store_copy_files_copy_id_store_copies_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_copy_files
    ADD CONSTRAINT store_copy_files_copy_id_store_copies_id_fk FOREIGN KEY (copy_id) REFERENCES commerce.store_copies(id) ON DELETE CASCADE;


--
-- Name: store_currencies store_currencies_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_currencies
    ADD CONSTRAINT store_currencies_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_demo_items store_demo_items_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_demo_items
    ADD CONSTRAINT store_demo_items_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: store_domains store_domains_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_domains
    ADD CONSTRAINT store_domains_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: store_domains store_domains_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_domains
    ADD CONSTRAINT store_domains_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: store_drafts store_drafts_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_drafts
    ADD CONSTRAINT store_drafts_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: store_drafts store_drafts_install_id_store_theme_installs_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_drafts
    ADD CONSTRAINT store_drafts_install_id_store_theme_installs_id_fk FOREIGN KEY (install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE SET NULL;


--
-- Name: store_drafts store_drafts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_drafts
    ADD CONSTRAINT store_drafts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: store_events store_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_events
    ADD CONSTRAINT store_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: store_home_takes store_home_takes_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_home_takes
    ADD CONSTRAINT store_home_takes_page_id_pages_id_fk FOREIGN KEY (page_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: store_home_takes store_home_takes_previous_front_page_id_pages_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_home_takes
    ADD CONSTRAINT store_home_takes_previous_front_page_id_pages_id_fk FOREIGN KEY (previous_front_page_id) REFERENCES commerce.pages(id) ON DELETE SET NULL;


--
-- Name: store_home_takes store_home_takes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_home_takes
    ADD CONSTRAINT store_home_takes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: store_home_takes store_home_takes_taken_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_home_takes
    ADD CONSTRAINT store_home_takes_taken_by_accounts_id_fk FOREIGN KEY (taken_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: store_integrations store_integrations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_integrations
    ADD CONSTRAINT store_integrations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_integrations store_integrations_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_integrations
    ADD CONSTRAINT store_integrations_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: store_locations store_locations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_locations
    ADD CONSTRAINT store_locations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_members store_members_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_members
    ADD CONSTRAINT store_members_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: store_members store_members_invited_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_members
    ADD CONSTRAINT store_members_invited_by_accounts_id_fk FOREIGN KEY (invited_by) REFERENCES commerce.accounts(id);


--
-- Name: store_members store_members_role_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_members
    ADD CONSTRAINT store_members_role_fk FOREIGN KEY (store_id, role_id) REFERENCES commerce.store_roles(store_id, id) ON DELETE RESTRICT;


--
-- Name: store_members store_members_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_members
    ADD CONSTRAINT store_members_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_roles store_roles_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_roles
    ADD CONSTRAINT store_roles_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: store_roles store_roles_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_roles
    ADD CONSTRAINT store_roles_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_starters store_starters_archived_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_archived_by_accounts_id_fk FOREIGN KEY (archived_by) REFERENCES commerce.accounts(id);


--
-- Name: store_starters store_starters_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: store_starters store_starters_design_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_design_preset_id_design_presets_id_fk FOREIGN KEY (design_preset_id) REFERENCES commerce.design_presets(id) ON DELETE SET NULL;


--
-- Name: store_starters store_starters_pictures_wanted_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_pictures_wanted_by_accounts_id_fk FOREIGN KEY (pictures_wanted_by) REFERENCES commerce.accounts(id);


--
-- Name: store_starters store_starters_published_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_published_store_id_stores_id_fk FOREIGN KEY (published_store_id) REFERENCES commerce.stores(id);


--
-- Name: store_starters store_starters_recommended_design_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_recommended_design_design_presets_id_fk FOREIGN KEY (recommended_design) REFERENCES commerce.design_presets(id);


--
-- Name: store_starters store_starters_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_starters store_starters_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_starters
    ADD CONSTRAINT store_starters_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: store_tax_profile store_tax_profile_oss_member_state_countries_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_tax_profile
    ADD CONSTRAINT store_tax_profile_oss_member_state_countries_code_fk FOREIGN KEY (oss_member_state) REFERENCES commerce.countries(code);


--
-- Name: store_tax_profile store_tax_profile_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_tax_profile
    ADD CONSTRAINT store_tax_profile_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_tax_profile store_tax_profile_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_tax_profile
    ADD CONSTRAINT store_tax_profile_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: store_tax_profile store_tax_profile_vat_check_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_tax_profile
    ADD CONSTRAINT store_tax_profile_vat_check_fk FOREIGN KEY (store_id, vat_number_check_id) REFERENCES commerce.vat_checks(store_id, id);


--
-- Name: store_theme_installs store_theme_installs_installed_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_theme_installs
    ADD CONSTRAINT store_theme_installs_installed_by_accounts_id_fk FOREIGN KEY (installed_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: store_theme_installs store_theme_installs_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_theme_installs
    ADD CONSTRAINT store_theme_installs_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id);


--
-- Name: store_theme_installs store_theme_installs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_theme_installs
    ADD CONSTRAINT store_theme_installs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: store_theme_installs store_theme_installs_version_id_design_preset_versions_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_theme_installs
    ADD CONSTRAINT store_theme_installs_version_id_design_preset_versions_id_fk FOREIGN KEY (version_id) REFERENCES commerce.design_preset_versions(id);


--
-- Name: store_themes store_themes_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_themes
    ADD CONSTRAINT store_themes_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: store_themes store_themes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_themes
    ADD CONSTRAINT store_themes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: store_usage_daily store_usage_daily_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.store_usage_daily
    ADD CONSTRAINT store_usage_daily_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: storefront_tokens storefront_tokens_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.storefront_tokens
    ADD CONSTRAINT storefront_tokens_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: storefront_tokens storefront_tokens_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.storefront_tokens
    ADD CONSTRAINT storefront_tokens_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: stores stores_country_countries_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_country_countries_code_fk FOREIGN KEY (country) REFERENCES commerce.countries(code);


--
-- Name: stores stores_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: stores stores_footer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_footer_fk FOREIGN KEY (id, footer_id) REFERENCES commerce.pages(store_id, id) ON DELETE SET NULL (footer_id);


--
-- Name: stores stores_footer_menu_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_footer_menu_fk FOREIGN KEY (id, footer_menu_id) REFERENCES commerce.menus(store_id, id) ON DELETE SET NULL (footer_menu_id);


--
-- Name: stores stores_front_page_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_front_page_fk FOREIGN KEY (id, front_page_id) REFERENCES commerce.pages(store_id, id) ON DELETE SET NULL (front_page_id);


--
-- Name: stores stores_header_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_header_fk FOREIGN KEY (id, header_id) REFERENCES commerce.pages(store_id, id) ON DELETE SET NULL (header_id);


--
-- Name: stores stores_header_menu_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_header_menu_fk FOREIGN KEY (id, header_menu_id) REFERENCES commerce.menus(store_id, id) ON DELETE SET NULL (header_menu_id);


--
-- Name: stores stores_made_from_starter_store_starters_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_made_from_starter_store_starters_id_fk FOREIGN KEY (made_from_starter) REFERENCES commerce.store_starters(id);


--
-- Name: stores stores_product_layout_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_product_layout_fk FOREIGN KEY (id, product_layout_id) REFERENCES commerce.pages(store_id, id) ON DELETE SET NULL (product_layout_id);


--
-- Name: stores stores_products_page_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_products_page_fk FOREIGN KEY (id, products_page_id) REFERENCES commerce.pages(store_id, id) ON DELETE SET NULL (products_page_id);


--
-- Name: stores stores_starter_copy_of_store_starters_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stores
    ADD CONSTRAINT stores_starter_copy_of_store_starters_id_fk FOREIGN KEY (starter_copy_of) REFERENCES commerce.store_starters(id) ON DELETE SET NULL;


--
-- Name: stripe_accounts stripe_accounts_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stripe_accounts
    ADD CONSTRAINT stripe_accounts_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: stripe_accounts stripe_accounts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.stripe_accounts
    ADD CONSTRAINT stripe_accounts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: subscription_lines subscription_lines_selling_plan_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscription_lines
    ADD CONSTRAINT subscription_lines_selling_plan_fk FOREIGN KEY (store_id, selling_plan_id) REFERENCES commerce.selling_plans(store_id, id);


--
-- Name: subscription_lines subscription_lines_subscription_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscription_lines
    ADD CONSTRAINT subscription_lines_subscription_fk FOREIGN KEY (store_id, subscription_id) REFERENCES commerce.subscriptions(store_id, id) ON DELETE CASCADE;


--
-- Name: subscription_lines subscription_lines_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscription_lines
    ADD CONSTRAINT subscription_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: subscriptions subscriptions_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscriptions
    ADD CONSTRAINT subscriptions_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id);


--
-- Name: subscriptions subscriptions_first_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.subscriptions
    ADD CONSTRAINT subscriptions_first_order_fk FOREIGN KEY (store_id, first_order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: supplier_invoices supplier_invoices_book_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_book_fk FOREIGN KEY (store_id, book_id) REFERENCES commerce.ledger_books(store_id, id);


--
-- Name: supplier_invoices supplier_invoices_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: supplier_invoices supplier_invoices_entry_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_entry_fk FOREIGN KEY (store_id, entry_id) REFERENCES commerce.ledger_entries(store_id, id);


--
-- Name: supplier_invoices supplier_invoices_paid_entry_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_paid_entry_fk FOREIGN KEY (store_id, paid_entry_id) REFERENCES commerce.ledger_entries(store_id, id);


--
-- Name: supplier_invoices supplier_invoices_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: supplier_invoices supplier_invoices_supplier_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_invoices
    ADD CONSTRAINT supplier_invoices_supplier_fk FOREIGN KEY (store_id, supplier_id) REFERENCES commerce.suppliers(store_id, id);


--
-- Name: supplier_order_lines supplier_order_lines_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_order_lines
    ADD CONSTRAINT supplier_order_lines_line_fk FOREIGN KEY (store_id, order_line_id) REFERENCES commerce.order_lines(store_id, id);


--
-- Name: supplier_order_lines supplier_order_lines_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_order_lines
    ADD CONSTRAINT supplier_order_lines_order_fk FOREIGN KEY (store_id, supplier_order_id) REFERENCES commerce.supplier_orders(store_id, id) ON DELETE CASCADE;


--
-- Name: supplier_orders supplier_orders_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_orders
    ADD CONSTRAINT supplier_orders_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: supplier_orders supplier_orders_supplier_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.supplier_orders
    ADD CONSTRAINT supplier_orders_supplier_fk FOREIGN KEY (store_id, supplier_id) REFERENCES commerce.suppliers(store_id, id);


--
-- Name: suppliers suppliers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.suppliers
    ADD CONSTRAINT suppliers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: support_actions support_actions_conversation_id_support_conversations_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_actions
    ADD CONSTRAINT support_actions_conversation_id_support_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES commerce.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_actions support_actions_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_actions
    ADD CONSTRAINT support_actions_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: support_actions support_actions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_actions
    ADD CONSTRAINT support_actions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: support_agents support_agents_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_agents
    ADD CONSTRAINT support_agents_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: support_agents support_agents_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_agents
    ADD CONSTRAINT support_agents_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: support_conversations support_conversations_about_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_about_store_id_stores_id_fk FOREIGN KEY (about_store_id) REFERENCES commerce.stores(id) ON DELETE SET NULL;


--
-- Name: support_conversations support_conversations_assignee_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_assignee_id_accounts_id_fk FOREIGN KEY (assignee_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: support_conversations support_conversations_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (customer_id);


--
-- Name: support_conversations support_conversations_requester_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_requester_id_accounts_id_fk FOREIGN KEY (requester_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: support_conversations support_conversations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_conversations
    ADD CONSTRAINT support_conversations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: support_inbound_emails support_inbound_emails_conversation_id_support_conversations_id; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_inbound_emails
    ADD CONSTRAINT support_inbound_emails_conversation_id_support_conversations_id FOREIGN KEY (conversation_id) REFERENCES commerce.support_conversations(id) ON DELETE SET NULL;


--
-- Name: support_inbound_emails support_inbound_emails_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_inbound_emails
    ADD CONSTRAINT support_inbound_emails_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_messages
    ADD CONSTRAINT support_messages_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_action_id_support_actions_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_messages
    ADD CONSTRAINT support_messages_action_id_support_actions_id_fk FOREIGN KEY (action_id) REFERENCES commerce.support_actions(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_conversation_id_support_conversations_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_messages
    ADD CONSTRAINT support_messages_conversation_id_support_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES commerce.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_messages
    ADD CONSTRAINT support_messages_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: support_reads support_reads_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_reads
    ADD CONSTRAINT support_reads_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: support_reads support_reads_conversation_id_support_conversations_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_reads
    ADD CONSTRAINT support_reads_conversation_id_support_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES commerce.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_replies support_replies_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_replies
    ADD CONSTRAINT support_replies_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: support_replies support_replies_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_replies
    ADD CONSTRAINT support_replies_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: support_settings support_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_settings
    ADD CONSTRAINT support_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: support_settings support_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.support_settings
    ADD CONSTRAINT support_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: tax_rate_overrides tax_rate_overrides_set_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tax_rate_overrides
    ADD CONSTRAINT tax_rate_overrides_set_by_accounts_id_fk FOREIGN KEY (set_by) REFERENCES commerce.accounts(id);


--
-- Name: tax_rate_overrides tax_rate_overrides_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tax_rate_overrides
    ADD CONSTRAINT tax_rate_overrides_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: tax_report_exports tax_report_exports_exported_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tax_report_exports
    ADD CONSTRAINT tax_report_exports_exported_by_accounts_id_fk FOREIGN KEY (exported_by) REFERENCES commerce.accounts(id);


--
-- Name: tax_report_exports tax_report_exports_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tax_report_exports
    ADD CONSTRAINT tax_report_exports_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: template_activations template_activations_changed_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.template_activations
    ADD CONSTRAINT template_activations_changed_by_accounts_id_fk FOREIGN KEY (changed_by) REFERENCES commerce.accounts(id);


--
-- Name: template_activations template_activations_part_id_saved_parts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.template_activations
    ADD CONSTRAINT template_activations_part_id_saved_parts_id_fk FOREIGN KEY (part_id) REFERENCES commerce.saved_parts(id) ON DELETE CASCADE;


--
-- Name: template_activations template_activations_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.template_activations
    ADD CONSTRAINT template_activations_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: terms terms_parent_id_terms_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.terms
    ADD CONSTRAINT terms_parent_id_terms_id_fk FOREIGN KEY (parent_id) REFERENCES commerce.terms(id) ON DELETE SET NULL;


--
-- Name: terms terms_product_layout_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.terms
    ADD CONSTRAINT terms_product_layout_fk FOREIGN KEY (store_id, product_layout_id) REFERENCES commerce.pages(store_id, id) ON DELETE SET NULL (product_layout_id);


--
-- Name: terms terms_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.terms
    ADD CONSTRAINT terms_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: text_styles text_styles_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.text_styles
    ADD CONSTRAINT text_styles_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: text_styles text_styles_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.text_styles
    ADD CONSTRAINT text_styles_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: text_styles text_styles_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.text_styles
    ADD CONSTRAINT text_styles_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: theme_install_updates theme_install_updates_from_version_id_design_preset_versions_id; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_install_updates
    ADD CONSTRAINT theme_install_updates_from_version_id_design_preset_versions_id FOREIGN KEY (from_version_id) REFERENCES commerce.design_preset_versions(id) ON DELETE SET NULL;


--
-- Name: theme_install_updates theme_install_updates_install_id_store_theme_installs_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_install_updates
    ADD CONSTRAINT theme_install_updates_install_id_store_theme_installs_id_fk FOREIGN KEY (install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE CASCADE;


--
-- Name: theme_install_updates theme_install_updates_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_install_updates
    ADD CONSTRAINT theme_install_updates_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: theme_install_updates theme_install_updates_to_version_id_design_preset_versions_id_f; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_install_updates
    ADD CONSTRAINT theme_install_updates_to_version_id_design_preset_versions_id_f FOREIGN KEY (to_version_id) REFERENCES commerce.design_preset_versions(id) ON DELETE SET NULL;


--
-- Name: theme_install_updates theme_install_updates_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_install_updates
    ADD CONSTRAINT theme_install_updates_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: theme_prices theme_prices_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_prices
    ADD CONSTRAINT theme_prices_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id) ON DELETE CASCADE;


--
-- Name: theme_prices theme_prices_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_prices
    ADD CONSTRAINT theme_prices_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: theme_purchases theme_purchases_chosen_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_purchases
    ADD CONSTRAINT theme_purchases_chosen_by_accounts_id_fk FOREIGN KEY (chosen_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: theme_purchases theme_purchases_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_purchases
    ADD CONSTRAINT theme_purchases_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id);


--
-- Name: theme_purchases theme_purchases_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_purchases
    ADD CONSTRAINT theme_purchases_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: theme_schedules theme_schedules_before_install_id_store_theme_installs_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_schedules
    ADD CONSTRAINT theme_schedules_before_install_id_store_theme_installs_id_fk FOREIGN KEY (before_install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE SET NULL;


--
-- Name: theme_schedules theme_schedules_install_id_store_theme_installs_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_schedules
    ADD CONSTRAINT theme_schedules_install_id_store_theme_installs_id_fk FOREIGN KEY (install_id) REFERENCES commerce.store_theme_installs(id) ON DELETE SET NULL;


--
-- Name: theme_schedules theme_schedules_scheduled_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_schedules
    ADD CONSTRAINT theme_schedules_scheduled_by_accounts_id_fk FOREIGN KEY (scheduled_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: theme_schedules theme_schedules_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_schedules
    ADD CONSTRAINT theme_schedules_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: theme_shots theme_shots_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_shots
    ADD CONSTRAINT theme_shots_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id) ON DELETE CASCADE;


--
-- Name: theme_submissions theme_submissions_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_submissions
    ADD CONSTRAINT theme_submissions_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: theme_submissions theme_submissions_content_starter_id_store_starters_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_submissions
    ADD CONSTRAINT theme_submissions_content_starter_id_store_starters_id_fk FOREIGN KEY (content_starter_id) REFERENCES commerce.store_starters(id);


--
-- Name: theme_submissions theme_submissions_decided_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_submissions
    ADD CONSTRAINT theme_submissions_decided_by_accounts_id_fk FOREIGN KEY (decided_by) REFERENCES commerce.accounts(id);


--
-- Name: theme_submissions theme_submissions_preset_id_design_presets_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_submissions
    ADD CONSTRAINT theme_submissions_preset_id_design_presets_id_fk FOREIGN KEY (preset_id) REFERENCES commerce.design_presets(id);


--
-- Name: theme_submissions theme_submissions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.theme_submissions
    ADD CONSTRAINT theme_submissions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: tripletex_connections tripletex_connections_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tripletex_connections
    ADD CONSTRAINT tripletex_connections_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: tripletex_connections tripletex_connections_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tripletex_connections
    ADD CONSTRAINT tripletex_connections_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: tripletex_sync tripletex_sync_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.tripletex_sync
    ADD CONSTRAINT tripletex_sync_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: turnover_thresholds turnover_thresholds_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.turnover_thresholds
    ADD CONSTRAINT turnover_thresholds_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: turnover_thresholds turnover_thresholds_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.turnover_thresholds
    ADD CONSTRAINT turnover_thresholds_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: ui_translations ui_translations_lang_platform_languages_lang_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.ui_translations
    ADD CONSTRAINT ui_translations_lang_platform_languages_lang_fk FOREIGN KEY (lang) REFERENCES commerce.platform_languages(lang) ON DELETE CASCADE;


--
-- Name: unsent_closures unsent_closures_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.unsent_closures
    ADD CONSTRAINT unsent_closures_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: unsent_closures unsent_closures_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.unsent_closures
    ADD CONSTRAINT unsent_closures_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id) ON DELETE RESTRICT;


--
-- Name: unsent_closures unsent_closures_order_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.unsent_closures
    ADD CONSTRAINT unsent_closures_order_line_fk FOREIGN KEY (store_id, order_line_id) REFERENCES commerce.order_lines(store_id, id) ON DELETE RESTRICT;


--
-- Name: unsent_closures unsent_closures_refund_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.unsent_closures
    ADD CONSTRAINT unsent_closures_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES commerce.refunds(store_id, id) ON DELETE RESTRICT;


--
-- Name: variant_cost_history variant_cost_history_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.variant_cost_history
    ADD CONSTRAINT variant_cost_history_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id);


--
-- Name: vat_categories vat_categories_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_categories
    ADD CONSTRAINT vat_categories_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: vat_checks vat_checks_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_checks
    ADD CONSTRAINT vat_checks_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: vat_rates vat_rates_category_vat_categories_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_rates
    ADD CONSTRAINT vat_rates_category_vat_categories_code_fk FOREIGN KEY (category) REFERENCES commerce.vat_categories(code);


--
-- Name: vat_rates vat_rates_country_code_countries_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_rates
    ADD CONSTRAINT vat_rates_country_code_countries_code_fk FOREIGN KEY (country_code) REFERENCES commerce.countries(code);


--
-- Name: vat_rates vat_rates_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_rates
    ADD CONSTRAINT vat_rates_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: vat_rates vat_rates_verified_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.vat_rates
    ADD CONSTRAINT vat_rates_verified_by_accounts_id_fk FOREIGN KEY (verified_by) REFERENCES commerce.accounts(id);


--
-- Name: visits visits_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.visits
    ADD CONSTRAINT visits_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id) ON DELETE CASCADE;


--
-- Name: webhook_endpoints webhook_endpoints_app_grant_id_oauth_grants_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_app_grant_id_oauth_grants_id_fk FOREIGN KEY (app_grant_id) REFERENCES commerce.oauth_grants(id) ON DELETE CASCADE;


--
-- Name: webhook_endpoints webhook_endpoints_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: webhook_endpoints webhook_endpoints_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: webhook_events webhook_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.webhook_events
    ADD CONSTRAINT webhook_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: wishlist_cart_adds wishlist_cart_adds_cart_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_cart_adds
    ADD CONSTRAINT wishlist_cart_adds_cart_fk FOREIGN KEY (store_id, cart_id) REFERENCES commerce.carts(store_id, id) ON DELETE CASCADE;


--
-- Name: wishlist_cart_adds wishlist_cart_adds_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_cart_adds
    ADD CONSTRAINT wishlist_cart_adds_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (customer_id);


--
-- Name: wishlist_cart_adds wishlist_cart_adds_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_cart_adds
    ADD CONSTRAINT wishlist_cart_adds_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE SET NULL (product_id);


--
-- Name: wishlist_cart_adds wishlist_cart_adds_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_cart_adds
    ADD CONSTRAINT wishlist_cart_adds_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE SET NULL (variant_id);


--
-- Name: wishlist_cart_adds wishlist_cart_adds_wishlist_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_cart_adds
    ADD CONSTRAINT wishlist_cart_adds_wishlist_fk FOREIGN KEY (store_id, wishlist_id) REFERENCES commerce.wishlists(store_id, id) ON DELETE SET NULL (wishlist_id);


--
-- Name: wishlist_items wishlist_items_product_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_items
    ADD CONSTRAINT wishlist_items_product_fk FOREIGN KEY (store_id, product_id) REFERENCES commerce.products(store_id, id) ON DELETE CASCADE;


--
-- Name: wishlist_items wishlist_items_variant_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_items
    ADD CONSTRAINT wishlist_items_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants(store_id, id) ON DELETE SET NULL (variant_id);


--
-- Name: wishlist_items wishlist_items_wishlist_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlist_items
    ADD CONSTRAINT wishlist_items_wishlist_fk FOREIGN KEY (store_id, wishlist_id) REFERENCES commerce.wishlists(store_id, id) ON DELETE CASCADE;


--
-- Name: wishlists wishlists_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlists
    ADD CONSTRAINT wishlists_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE CASCADE;


--
-- Name: wishlists wishlists_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wishlists
    ADD CONSTRAINT wishlists_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: withdrawal_attempts withdrawal_attempts_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_attempts
    ADD CONSTRAINT withdrawal_attempts_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: withdrawal_request_lines withdrawal_request_lines_order_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_request_lines
    ADD CONSTRAINT withdrawal_request_lines_order_line_fk FOREIGN KEY (store_id, order_line_id) REFERENCES commerce.order_lines(store_id, id);


--
-- Name: withdrawal_request_lines withdrawal_request_lines_request_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_request_lines
    ADD CONSTRAINT withdrawal_request_lines_request_fk FOREIGN KEY (store_id, withdrawal_request_id) REFERENCES commerce.withdrawal_requests(store_id, id) ON DELETE CASCADE;


--
-- Name: withdrawal_requests withdrawal_requests_order_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_order_fk FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders(store_id, id);


--
-- Name: wordpress_connections wordpress_connections_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.wordpress_connections
    ADD CONSTRAINT wordpress_connections_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id) ON DELETE CASCADE;


--
-- Name: work_assignments work_assignments_client_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_assignments
    ADD CONSTRAINT work_assignments_client_fk FOREIGN KEY (store_id, client_id) REFERENCES commerce.work_clients(store_id, id);


--
-- Name: work_assignments work_assignments_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_assignments
    ADD CONSTRAINT work_assignments_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: work_assignments work_assignments_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_assignments
    ADD CONSTRAINT work_assignments_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_clients work_clients_company_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_clients
    ADD CONSTRAINT work_clients_company_fk FOREIGN KEY (store_id, customer_company_id) REFERENCES commerce.customer_companies(store_id, id) ON DELETE SET NULL (customer_company_id);


--
-- Name: work_clients work_clients_country_countries_code_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_clients
    ADD CONSTRAINT work_clients_country_countries_code_fk FOREIGN KEY (country) REFERENCES commerce.countries(code);


--
-- Name: work_clients work_clients_customer_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_clients
    ADD CONSTRAINT work_clients_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers(store_id, id) ON DELETE SET NULL (customer_id);


--
-- Name: work_clients work_clients_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_clients
    ADD CONSTRAINT work_clients_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_credit_notes work_credit_notes_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: work_credit_notes work_credit_notes_invoice_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_invoice_fk FOREIGN KEY (store_id, invoice_id) REFERENCES commerce.work_invoices(store_id, id);


--
-- Name: work_credit_notes work_credit_notes_series_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_series_fk FOREIGN KEY (store_id, series) REFERENCES commerce.document_series(store_id, series);


--
-- Name: work_credit_notes work_credit_notes_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_credit_notes
    ADD CONSTRAINT work_credit_notes_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_events work_events_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_events
    ADD CONSTRAINT work_events_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: work_events work_events_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_events
    ADD CONSTRAINT work_events_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_invoice_lines work_invoice_lines_assignment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_lines
    ADD CONSTRAINT work_invoice_lines_assignment_fk FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments(store_id, id) ON DELETE SET NULL (assignment_id);


--
-- Name: work_invoice_lines work_invoice_lines_invoice_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_lines
    ADD CONSTRAINT work_invoice_lines_invoice_fk FOREIGN KEY (store_id, invoice_id) REFERENCES commerce.work_invoices(store_id, id) ON DELETE CASCADE;


--
-- Name: work_invoice_lines work_invoice_lines_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_lines
    ADD CONSTRAINT work_invoice_lines_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_invoice_lines work_invoice_lines_task_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_lines
    ADD CONSTRAINT work_invoice_lines_task_fk FOREIGN KEY (store_id, task_id) REFERENCES commerce.work_tasks(store_id, id) ON DELETE SET NULL (task_id);


--
-- Name: work_invoice_losses work_invoice_losses_invoice_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_losses
    ADD CONSTRAINT work_invoice_losses_invoice_fk FOREIGN KEY (store_id, invoice_id) REFERENCES commerce.work_invoices(store_id, id);


--
-- Name: work_invoice_losses work_invoice_losses_recorded_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_losses
    ADD CONSTRAINT work_invoice_losses_recorded_by_accounts_id_fk FOREIGN KEY (recorded_by) REFERENCES commerce.accounts(id);


--
-- Name: work_invoice_losses work_invoice_losses_reverses_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_losses
    ADD CONSTRAINT work_invoice_losses_reverses_fk FOREIGN KEY (store_id, reverses) REFERENCES commerce.work_invoice_losses(store_id, id);


--
-- Name: work_invoice_losses work_invoice_losses_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_losses
    ADD CONSTRAINT work_invoice_losses_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_invoice_payments work_invoice_payments_invoice_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_payments
    ADD CONSTRAINT work_invoice_payments_invoice_fk FOREIGN KEY (store_id, invoice_id) REFERENCES commerce.work_invoices(store_id, id);


--
-- Name: work_invoice_payments work_invoice_payments_recorded_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_payments
    ADD CONSTRAINT work_invoice_payments_recorded_by_accounts_id_fk FOREIGN KEY (recorded_by) REFERENCES commerce.accounts(id);


--
-- Name: work_invoice_payments work_invoice_payments_reverses_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_payments
    ADD CONSTRAINT work_invoice_payments_reverses_fk FOREIGN KEY (store_id, reverses) REFERENCES commerce.work_invoice_payments(store_id, id);


--
-- Name: work_invoice_payments work_invoice_payments_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoice_payments
    ADD CONSTRAINT work_invoice_payments_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_invoices work_invoices_assignment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_assignment_fk FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments(store_id, id);


--
-- Name: work_invoices work_invoices_client_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_client_fk FOREIGN KEY (store_id, client_id) REFERENCES commerce.work_clients(store_id, id);


--
-- Name: work_invoices work_invoices_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id);


--
-- Name: work_invoices work_invoices_recurring_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_recurring_fk FOREIGN KEY (store_id, recurring_invoice_id) REFERENCES commerce.work_recurring_invoices(store_id, id);


--
-- Name: work_invoices work_invoices_series_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_series_fk FOREIGN KEY (store_id, series) REFERENCES commerce.document_series(store_id, series);


--
-- Name: work_invoices work_invoices_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_invoices
    ADD CONSTRAINT work_invoices_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_recurring_invoices work_recurring_invoices_client_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_recurring_invoices
    ADD CONSTRAINT work_recurring_invoices_client_fk FOREIGN KEY (store_id, client_id) REFERENCES commerce.work_clients(store_id, id);


--
-- Name: work_recurring_invoices work_recurring_invoices_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_recurring_invoices
    ADD CONSTRAINT work_recurring_invoices_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_settings work_settings_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_settings
    ADD CONSTRAINT work_settings_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_settings work_settings_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_settings
    ADD CONSTRAINT work_settings_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id);


--
-- Name: work_tasks work_tasks_assignment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_tasks
    ADD CONSTRAINT work_tasks_assignment_fk FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments(store_id, id) ON DELETE CASCADE;


--
-- Name: work_tasks work_tasks_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_tasks
    ADD CONSTRAINT work_tasks_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_time_entries work_time_entries_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_time_entries
    ADD CONSTRAINT work_time_entries_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: work_time_entries work_time_entries_assignment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_time_entries
    ADD CONSTRAINT work_time_entries_assignment_fk FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments(store_id, id);


--
-- Name: work_time_entries work_time_entries_line_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_time_entries
    ADD CONSTRAINT work_time_entries_line_fk FOREIGN KEY (store_id, invoice_line_id) REFERENCES commerce.work_invoice_lines(store_id, id) ON DELETE SET NULL (invoice_line_id);


--
-- Name: work_time_entries work_time_entries_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_time_entries
    ADD CONSTRAINT work_time_entries_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_time_entries work_time_entries_task_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_time_entries
    ADD CONSTRAINT work_time_entries_task_fk FOREIGN KEY (store_id, assignment_id, task_id) REFERENCES commerce.work_tasks(store_id, assignment_id, id) ON DELETE SET NULL (task_id);


--
-- Name: work_timers work_timers_account_id_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_timers
    ADD CONSTRAINT work_timers_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES commerce.accounts(id);


--
-- Name: work_timers work_timers_assignment_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_timers
    ADD CONSTRAINT work_timers_assignment_fk FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments(store_id, id) ON DELETE CASCADE;


--
-- Name: work_timers work_timers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_timers
    ADD CONSTRAINT work_timers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: work_timers work_timers_task_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.work_timers
    ADD CONSTRAINT work_timers_task_fk FOREIGN KEY (store_id, assignment_id, task_id) REFERENCES commerce.work_tasks(store_id, assignment_id, id) ON DELETE CASCADE;


--
-- Name: workflow_runs workflow_runs_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflow_runs
    ADD CONSTRAINT workflow_runs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: workflow_runs workflow_runs_workflow_id_workflows_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_id_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES commerce.workflows(id) ON DELETE CASCADE;


--
-- Name: workflows workflows_created_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflows
    ADD CONSTRAINT workflows_created_by_accounts_id_fk FOREIGN KEY (created_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: workflows workflows_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflows
    ADD CONSTRAINT workflows_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES commerce.stores(id);


--
-- Name: workflows workflows_updated_by_accounts_id_fk; Type: FK CONSTRAINT; Schema: commerce; Owner: -
--

ALTER TABLE ONLY commerce.workflows
    ADD CONSTRAINT workflows_updated_by_accounts_id_fk FOREIGN KEY (updated_by) REFERENCES commerce.accounts(id) ON DELETE SET NULL;


--
-- Name: abandoned_checkouts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.abandoned_checkouts ENABLE ROW LEVEL SECURITY;

--
-- Name: abandoned_plan_checkouts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.abandoned_plan_checkouts ENABLE ROW LEVEL SECURITY;

--
-- Name: access_requests; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.access_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: accessibility_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.accessibility_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: account_recovery_codes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.account_recovery_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: activities; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_connections; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ad_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_conversions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ad_conversions ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliate_attributions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.affiliate_attributions ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliate_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.affiliate_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: affiliates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.affiliates ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_eval_runs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ai_eval_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_model_prices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ai_model_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_providers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ai_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ai_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_alert_sends; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.analytics_alert_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.analytics_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_targets; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.analytics_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: api_app_idempotency_keys; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.api_app_idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: api_idempotency_keys; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.api_idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: api_tokens; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.api_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: api_uploads; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.api_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: appointment_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.appointment_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: apps; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.apps ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_approvals; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_conversations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_follow_ups; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_follow_ups ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_goals; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_memories; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_memories ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_messages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_notices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_plan_steps; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_plan_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_plans; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: assistant_skills; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.assistant_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_sends; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.automation_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: automations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.automations ENABLE ROW LEVEL SECURITY;

--
-- Name: autopilot_effects; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.autopilot_effects ENABLE ROW LEVEL SECURITY;

--
-- Name: autopilot_event_checks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.autopilot_event_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: autopilot_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.autopilot_events ENABLE ROW LEVEL SECURITY;

--
-- Name: autopilot_reports; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.autopilot_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: autopilot_reviews; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.autopilot_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: autopilot_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.autopilot_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bank_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_statements; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bank_statements ENABLE ROW LEVEL SECURITY;

--
-- Name: blog_authors; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.blog_authors ENABLE ROW LEVEL SECURITY;

--
-- Name: blog_comments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.blog_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: blogs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.blogs ENABLE ROW LEVEL SECURITY;

--
-- Name: bonus_allocations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bonus_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: bonus_entries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bonus_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: bonus_rewards; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bonus_rewards ENABLE ROW LEVEL SECURITY;

--
-- Name: bonus_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bonus_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_resources; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.booking_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_seasons; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.booking_seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: books_email; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.books_email ENABLE ROW LEVEL SECURITY;

--
-- Name: books_inbox; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.books_inbox ENABLE ROW LEVEL SECURITY;

--
-- Name: brand_profiles; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.brand_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_link_clicks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.broadcast_link_clicks ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_recipients; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.broadcast_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_templates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.broadcast_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcasts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.broadcasts ENABLE ROW LEVEL SECURITY;

--
-- Name: bulk_edit_batches; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bulk_edit_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: bulk_edit_items; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bulk_edit_items ENABLE ROW LEVEL SECURITY;

--
-- Name: bundle_components; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.bundle_components ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_feeds; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.calendar_feeds ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.capacity_events ENABLE ROW LEVEL SECURITY;

--
-- Name: carrier_labels; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.carrier_labels ENABLE ROW LEVEL SECURITY;

--
-- Name: cart_gift_cards; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.cart_gift_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: cart_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.cart_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: cart_reminder_steps; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.cart_reminder_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: carts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.carts ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_agents; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.chat_agents ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_usage; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.chat_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_accounts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.checkout_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_fields; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.checkout_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_providers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.checkout_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_rule_skips; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.checkout_rule_skips ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.checkout_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: company_invites; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.company_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: company_location_buyers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.company_location_buyers ENABLE ROW LEVEL SECURITY;

--
-- Name: company_locations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.company_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: consents; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.consents ENABLE ROW LEVEL SECURITY;

--
-- Name: content_entries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.content_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: content_reports; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.content_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: content_screened; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.content_screened ENABLE ROW LEVEL SECURITY;

--
-- Name: content_types; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.content_types ENABLE ROW LEVEL SECURITY;

--
-- Name: cookie_notes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.cookie_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: cookie_scans; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.cookie_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: countries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.countries ENABLE ROW LEVEL SECURITY;

--
-- Name: country_memberships; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.country_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: creator_attributions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.creator_attributions ENABLE ROW LEVEL SECURITY;

--
-- Name: creator_commissions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.creator_commissions ENABLE ROW LEVEL SECURITY;

--
-- Name: creator_payouts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.creator_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: creator_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.creator_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: creators; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.creators ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_notes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.credit_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_move_links; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.crm_move_links ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_moves; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.crm_moves ENABLE ROW LEVEL SECURITY;

--
-- Name: cron_jobs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.cron_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: css_versions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.css_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_apps; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.custom_apps ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_addresses; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_codes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_companies; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_companies ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_notes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_sessions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_sign_in_links; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_sign_in_links ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_tags; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_tiers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customer_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customs_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.customs_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: data_job_assets; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.data_job_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: data_job_items; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.data_job_items ENABLE ROW LEVEL SECURITY;

--
-- Name: data_jobs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.data_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_links; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.deal_links ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_moves; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.deal_moves ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_pipelines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.deal_pipelines ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_stages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.deal_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_quotes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.delivery_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_schedules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.delivery_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: design_preset_uses; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.design_preset_uses ENABLE ROW LEVEL SECURITY;

--
-- Name: design_preset_versions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.design_preset_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: design_presets; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.design_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: design_variations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.design_variations ENABLE ROW LEVEL SECURITY;

--
-- Name: developers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.developers ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_code_items; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.discount_code_items ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_codes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.discount_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: dispute_evidence; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.dispute_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: dns_changes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.dns_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: dns_zones; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.dns_zones ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_feedback; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_guide; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_guide ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_guide_conversations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_guide_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_guide_messages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_guide_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_index; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_index ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_index_state; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_index_state ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_reads; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: docs_search_misses; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.docs_search_misses ENABLE ROW LEVEL SECURITY;

--
-- Name: document_deliveries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.document_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: document_pdf_state; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.document_pdf_state ENABLE ROW LEVEL SECURITY;

--
-- Name: document_series; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.document_series ENABLE ROW LEVEL SECURITY;

--
-- Name: domain_pricing; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.domain_pricing ENABLE ROW LEVEL SECURITY;

--
-- Name: domain_purchases; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.domain_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: domain_registrants; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.domain_registrants ENABLE ROW LEVEL SECURITY;

--
-- Name: domain_registrations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.domain_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_order_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.draft_order_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_orders; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.draft_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: dream_runs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.dream_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: duty_rates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.duty_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: ecb_reference_rates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ecb_reference_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: economic_operators; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.economic_operators ENABLE ROW LEVEL SECURITY;

--
-- Name: einvoice_sends; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.einvoice_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: email_filing; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.email_filing ENABLE ROW LEVEL SECURITY;

--
-- Name: email_messages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.email_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: email_opt_outs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.email_opt_outs ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: experiment_carts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.experiment_carts ENABLE ROW LEVEL SECURITY;

--
-- Name: experiment_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.experiment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: experiment_exposures; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.experiment_exposures ENABLE ROW LEVEL SECURITY;

--
-- Name: experiment_variants; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.experiment_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: experiments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: feed_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.feed_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: field_groups; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.field_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: field_search; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.field_search ENABLE ROW LEVEL SECURITY;

--
-- Name: field_values; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.field_values ENABLE ROW LEVEL SECURITY;

--
-- Name: fiken_connections; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.fiken_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: fiken_sync; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.fiken_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: filed_emails; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.filed_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: font_files; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.font_files ENABLE ROW LEVEL SECURITY;

--
-- Name: fonts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.fonts ENABLE ROW LEVEL SECURITY;

--
-- Name: form_submissions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.form_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: gift_card_entries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.gift_card_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: gift_card_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.gift_card_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: gift_cards; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.gift_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: google_places; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.google_places ENABLE ROW LEVEL SECURITY;

--
-- Name: host_commissions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.host_commissions ENABLE ROW LEVEL SECURITY;

--
-- Name: host_stripe_accounts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.host_stripe_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: host_tax_details; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.host_tax_details ENABLE ROW LEVEL SECURITY;

--
-- Name: hosts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.hosts ENABLE ROW LEVEL SECURITY;

--
-- Name: house_customer_links; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.house_customer_links ENABLE ROW LEVEL SECURITY;

--
-- Name: house_site_copies; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.house_site_copies ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_keys; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: instagram_accounts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.instagram_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_deliveries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.integration_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_levels; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.inventory_levels ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_locations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.inventory_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_reservations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.inventory_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.invoice_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: kaizen_life_accounts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.kaizen_life_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: kaizen_life_handoffs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.kaizen_life_handoffs ENABLE ROW LEVEL SECURITY;

--
-- Name: kaizen_life_jtis; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.kaizen_life_jtis ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_chunks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.knowledge_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_documents; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.knowledge_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_decisions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.lead_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_accounts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_books; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_books ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_budgets; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_comparisons; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_comparisons ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_counters; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_entries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_vouchers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_vouchers ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_waiting; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ledger_waiting ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_ai_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.legal_ai_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_ai_writes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.legal_ai_writes ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_snapshots; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.legal_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_source_reads; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.legal_source_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_source_texts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.legal_source_texts ENABLE ROW LEVEL SECURITY;

--
-- Name: limit_overrides; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.limit_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: live_drills; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.live_drills ENABLE ROW LEVEL SECURITY;

--
-- Name: local_delivery_areas; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.local_delivery_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: look_versions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.look_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: market_availability; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.market_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: market_price_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.market_price_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_consent_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.marketing_consent_events ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_spend; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.marketing_spend ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_subscribers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.marketing_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_connections; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.marketplace_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_listings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.marketplace_listings ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_orders; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.marketplace_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: markets; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.markets ENABLE ROW LEVEL SECURITY;

--
-- Name: media; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.media ENABLE ROW LEVEL SECURITY;

--
-- Name: media_embeddings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.media_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: menus; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.menus ENABLE ROW LEVEL SECURITY;

--
-- Name: mollie_connections; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.mollie_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: not_found_hits; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.not_found_hits ENABLE ROW LEVEL SECURITY;

--
-- Name: not_found_ignored; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.not_found_ignored ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.notification_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: oauth_clients; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.oauth_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: oauth_grants; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.oauth_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: oauth_store_cutoffs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.oauth_store_cutoffs ENABLE ROW LEVEL SECURITY;

--
-- Name: oauth_tokens; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.oauth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: old_shops; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.old_shops ENABLE ROW LEVEL SECURITY;

--
-- Name: order_discount_codes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_discount_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: order_downloads; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_downloads ENABLE ROW LEVEL SECURITY;

--
-- Name: order_edit_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_edit_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: order_edits; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_edits ENABLE ROW LEVEL SECURITY;

--
-- Name: order_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: order_line_components; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_line_components ENABLE ROW LEVEL SECURITY;

--
-- Name: order_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: order_payment_terms; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_payment_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: order_rule_runs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_rule_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: order_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: order_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: order_tags; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: order_terms; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: order_views; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.order_views ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: own_speed_samples; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.own_speed_samples ENABLE ROW LEVEL SECURITY;

--
-- Name: page_ai_jobs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_ai_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: page_looks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_looks ENABLE ROW LEVEL SECURITY;

--
-- Name: page_redirects; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_redirects ENABLE ROW LEVEL SECURITY;

--
-- Name: page_replications; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_replications ENABLE ROW LEVEL SECURITY;

--
-- Name: page_roles; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: page_schedules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: page_theme_detaches; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_theme_detaches ENABLE ROW LEVEL SECURITY;

--
-- Name: page_versions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.page_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: pages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.pages ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_credentials; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payment_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_disputes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payment_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_methods; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_providers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payment_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payout_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_reads; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payout_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: payouts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: peppol_receivers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.peppol_receivers ENABLE ROW LEVEL SECURITY;

--
-- Name: pickup_options; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.pickup_options ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_feature_grants; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.plan_feature_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_features; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.plan_features ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_limits; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.plan_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_moves; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.plan_moves ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_prices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.plan_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_reminder_steps; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.plan_reminder_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: plans; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.plans ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_ad_conversions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_ad_conversions ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_api_tokens; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_api_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_discount_codes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_discount_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_integration_deliveries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_integration_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_integrations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_languages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_languages ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_marketing_spend; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_marketing_spend ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_page_roles; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_page_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_payout_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_payout_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_payouts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_sales; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_targets; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_theme_install_updates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_theme_install_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_theme_installs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_theme_installs ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_webhook_endpoints; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_webhook_endpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_webhooks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_webhooks ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_workflow_runs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_workflow_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_workflows; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.platform_workflows ENABLE ROW LEVEL SECURITY;

--
-- Name: postal_points; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.postal_points ENABLE ROW LEVEL SECURITY;

--
-- Name: preview_links; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.preview_links ENABLE ROW LEVEL SECURITY;

--
-- Name: price_breaks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.price_breaks ENABLE ROW LEVEL SECURITY;

--
-- Name: price_list_assignments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.price_list_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: price_list_breaks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.price_list_breaks ENABLE ROW LEVEL SECURITY;

--
-- Name: price_list_prices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.price_list_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: price_list_products; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.price_list_products ENABLE ROW LEVEL SECURITY;

--
-- Name: price_list_quantity_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.price_list_quantity_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: price_lists; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.price_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: prices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.prices ENABLE ROW LEVEL SECURITY;

--
-- Name: privacy_requests; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.privacy_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: producer_registrations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.producer_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: product_embeddings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: product_files; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_files ENABLE ROW LEVEL SECURITY;

--
-- Name: product_groups; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: product_market_texts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_market_texts ENABLE ROW LEVEL SECURITY;

--
-- Name: product_media; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_media ENABLE ROW LEVEL SECURITY;

--
-- Name: product_passports; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_passports ENABLE ROW LEVEL SECURITY;

--
-- Name: product_resources; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: product_reviews; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: product_safety_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_safety_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: product_schemes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_schemes ENABLE ROW LEVEL SECURITY;

--
-- Name: product_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: product_terms; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: product_translations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: product_views; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.product_views ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.products ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_order_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.purchase_order_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_orders; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: recommendation_adds; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.recommendation_adds ENABLE ROW LEVEL SECURITY;

--
-- Name: recommendation_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.recommendation_events ENABLE ROW LEVEL SECURITY;

--
-- Name: recommendation_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.recommendation_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: recommendation_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.recommendation_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_costs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.recurring_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: redirects; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.redirects ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_allocations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.referral_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_entries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.referral_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.referral_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_visits; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.referral_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: referrals; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.referrals ENABLE ROW LEVEL SECURITY;

--
-- Name: referrers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.referrers ENABLE ROW LEVEL SECURITY;

--
-- Name: refunds; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: report_schedules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.report_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: research_notes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.research_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: research_sources; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.research_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: resource_blocks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.resource_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: retention_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.retention_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: return_exchange_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.return_exchange_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: return_exchanges; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.return_exchanges ENABLE ROW LEVEL SECURITY;

--
-- Name: return_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.return_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: return_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.return_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: returns; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.returns ENABLE ROW LEVEL SECURITY;

--
-- Name: review_pictures; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.review_pictures ENABLE ROW LEVEL SECURITY;

--
-- Name: review_requests; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.review_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: review_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.review_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: sandboxes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.sandboxes ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_parts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.saved_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_reports; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.saved_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: search_cache; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.search_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: search_clicks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.search_clicks ENABLE ROW LEVEL SECURITY;

--
-- Name: search_experiments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.search_experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: search_queries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.search_queries ENABLE ROW LEVEL SECURITY;

--
-- Name: search_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.search_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: search_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.search_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: search_synonyms; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.search_synonyms ENABLE ROW LEVEL SECURITY;

--
-- Name: segments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.segments ENABLE ROW LEVEL SECURITY;

--
-- Name: selling_plans; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.selling_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: shipment_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipment_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: shipment_tracking; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipment_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: shipments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipments ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_carriers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_carriers ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_method_rates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_method_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_methods; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_profiles; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_rates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_vat_rules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_vat_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_zones; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shipping_zones ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_move_items; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shop_move_items ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_moves; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.shop_moves ENABLE ROW LEVEL SECURITY;

--
-- Name: signup_incentives; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.signup_incentives ENABLE ROW LEVEL SECURITY;

--
-- Name: site_staging_pages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.site_staging_pages ENABLE ROW LEVEL SECURITY;

--
-- Name: site_stagings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.site_stagings ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_campaigns; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.sms_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_consent_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.sms_consent_events ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_messages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.sms_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.sms_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_subscribers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.sms_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: speed_samples; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.speed_samples ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_alert_recipients; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.staff_alert_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_alert_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.staff_alert_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: standing_deliveries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.standing_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: standing_order_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.standing_order_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: standing_orders; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.standing_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: status_checks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.status_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: status_incident_updates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.status_incident_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: status_incidents; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.status_incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: status_subscribers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.status_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_alerts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stock_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_requests; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stock_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_transfer_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stock_transfer_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_transfers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stock_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: store_billing; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_billing ENABLE ROW LEVEL SECURITY;

--
-- Name: store_business_changes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_business_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: store_copies; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_copies ENABLE ROW LEVEL SECURITY;

--
-- Name: store_copy_files; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_copy_files ENABLE ROW LEVEL SECURITY;

--
-- Name: store_currencies; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_currencies ENABLE ROW LEVEL SECURITY;

--
-- Name: store_demo_items; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_demo_items ENABLE ROW LEVEL SECURITY;

--
-- Name: store_domains; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: store_drafts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: store_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_events ENABLE ROW LEVEL SECURITY;

--
-- Name: store_home_takes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_home_takes ENABLE ROW LEVEL SECURITY;

--
-- Name: store_integrations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: store_locations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: store_members; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_members ENABLE ROW LEVEL SECURITY;

--
-- Name: store_roles; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: store_starters; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_starters ENABLE ROW LEVEL SECURITY;

--
-- Name: store_tax_profile; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_tax_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: store_theme_installs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_theme_installs ENABLE ROW LEVEL SECURITY;

--
-- Name: store_themes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_themes ENABLE ROW LEVEL SECURITY;

--
-- Name: store_usage_daily; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.store_usage_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: storefront_tokens; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.storefront_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: stores; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stores ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_accounts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stripe_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_sync; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.stripe_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.subscription_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_invoices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.supplier_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_order_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.supplier_order_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_orders; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.supplier_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: support_actions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: support_agents; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_agents ENABLE ROW LEVEL SECURITY;

--
-- Name: support_conversations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: support_inbound_emails; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_inbound_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: support_messages; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: support_reads; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: support_replies; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_replies ENABLE ROW LEVEL SECURITY;

--
-- Name: support_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.support_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_rate_overrides; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.tax_rate_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_report_exports; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.tax_report_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: template_activations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.template_activations ENABLE ROW LEVEL SECURITY;

--
-- Name: terms; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.terms ENABLE ROW LEVEL SECURITY;

--
-- Name: text_styles; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.text_styles ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_install_updates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.theme_install_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_prices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.theme_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_purchases; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.theme_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_schedules; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.theme_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_shots; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.theme_shots ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_submissions; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.theme_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: tripletex_connections; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.tripletex_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: tripletex_sync; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.tripletex_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: turnover_thresholds; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.turnover_thresholds ENABLE ROW LEVEL SECURITY;

--
-- Name: ui_translations; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.ui_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: unsent_closures; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.unsent_closures ENABLE ROW LEVEL SECURITY;

--
-- Name: variant_cost_history; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.variant_cost_history ENABLE ROW LEVEL SECURITY;

--
-- Name: vat_categories; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.vat_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: vat_checks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.vat_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: vat_rates; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.vat_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: visits; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.visits ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_endpoints; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.webhook_endpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: wishlist_cart_adds; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.wishlist_cart_adds ENABLE ROW LEVEL SECURITY;

--
-- Name: wishlist_items; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.wishlist_items ENABLE ROW LEVEL SECURITY;

--
-- Name: wishlists; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.wishlists ENABLE ROW LEVEL SECURITY;

--
-- Name: withdrawal_attempts; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.withdrawal_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: withdrawal_request_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.withdrawal_request_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: withdrawal_requests; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.withdrawal_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: wordpress_connections; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.wordpress_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: work_assignments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: work_clients; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: work_credit_notes; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_credit_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: work_events; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_events ENABLE ROW LEVEL SECURITY;

--
-- Name: work_invoice_lines; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_invoice_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: work_invoice_losses; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_invoice_losses ENABLE ROW LEVEL SECURITY;

--
-- Name: work_invoice_payments; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_invoice_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: work_invoices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: work_recurring_invoices; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_recurring_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: work_settings; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: work_tasks; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: work_time_entries; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_time_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: work_timers; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.work_timers ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_runs; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.workflow_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: workflows; Type: ROW SECURITY; Schema: commerce; Owner: -
--

ALTER TABLE commerce.workflows ENABLE ROW LEVEL SECURITY;

--
--

RESET statement_timeout;
RESET lock_timeout;
RESET idle_in_transaction_session_timeout;
RESET client_encoding;
RESET standard_conforming_strings;
RESET check_function_bodies;
RESET xmloption;
RESET client_min_messages;
RESET row_security;
RESET default_tablespace;
RESET search_path;
