# Migration versions

Frozen on 4 October 2026: nothing is added here. The ledger `supabase_migrations.kaizen_files` (written by `scripts/db-migrate.mjs`) is the record of what was applied and when.

On 24 September 2026 Kaizen became multi-tenant (see [`platform.md`](platform.md)).
The single-store migrations were replaced by a fresh baseline. In production,
the old schema was not dropped: it was renamed to `commerce_legacy` and can be
removed once the platform schema has proved itself. Supabase's migration
history therefore still lists the nine single-store migrations, then:

| File | Recorded as |
|---|---|
| (no file: `ALTER SCHEMA commerce RENAME TO commerce_legacy`) | `20260924000447` retire_single_store_schema |
| `20260923235845_platform_schema.sql` | `20260924000725` |
| `20260923235847_platform_rules.sql` | `20260924060213` |
| `20260924061541_store_setup.sql` | `20260924063848` |
| `20260924061542_clone_store.sql` | `20260924064416` |
| `20260924065317_product_media_thumbnails.sql` | `20260924071204` |
| `20260924065318_product_media_bucket.sql` | `20260924071211` |
| `20260924072534_checkout.sql` | `20260924074159` |
| `20260924072554_checkout_rules.sql` | `20260924074241` |
| `20260924075026_reserve_account_slugs.sql` | `20260924081240` |
| `20260924083238_connect.sql` | `20260924085028` |
| `20260924083240_connect_rules.sql` | `20260924085032` |
| `20260924091504_plans.sql` | `20260924091925` |
| `20260924091505_plans_rules.sql` | `20260924091929` |
| `20260924102825_reserve_stores_slug.sql` | `20260924103331` |
| `20260924112911_test_payments_on.sql` | `20260924114012` |
| `20260924114622_stripe_account_details.sql` | `20260924115422` |
| `20260924120045_seo.sql` | `20260924122250` |
| `20260924130711_custom_checkout.sql` | `20260924131522` |
| `20260924134429_payment_methods.sql` | `20260924135246` |
| `20260924135903_payment_methods_shown.sql` | `20260924140745` |
| `20260924163005_digital_products.sql` | `20260924165727` |
| `20260924163034_digital_products_rules.sql` | `20260924170147` |
| `20260924171038_subscriptions.sql` | `20260924173027` |
| `20260924171040_subscriptions_rules.sql` | `20260924173148` |
| `20260924175024_emails.sql` | `20260924175231` |
| `20260924175025_emails_rules.sql` | `20260924175235` |
| `20260924175930_order_management.sql` | `20260924181207` |
| `20260924175931_order_management_rules.sql` | `20260924182019` |
| `20260924182608_customer_accounts.sql` | `20260924183834` |
| `20260924182609_customer_accounts_rules.sql` | `20260924185408` |
| `20260924191351_subscription_extras.sql` | `20260924193335` |
| `20260924191352_subscription_extras_rules.sql` | `20260924193421` |
| `20260924210201_store_navigation.sql` | `20260924212330` |
| `20260924210202_store_navigation_rules.sql` | `20260924212548` |
| `20260924213616_discount_codes.sql` | `20260924220006` |
| `20260924213617_discount_codes_rules.sql` | `20260924221251` |
| `20260924221909_editable_discounts.sql` | `20260924223848` |
| `20260924221911_editable_discounts_rules.sql` | `20260924223855` |
| `20260924224831_customer_registration.sql` | `20260924230355` |
| `20260924224832_customer_registration_rules.sql` | `20260924230523` |
| `20260924225610_email_delivery_events.sql` | `20260924230527` |
| `20260924235133_cart_reminders.sql` | `20260925000837` |
| `20260924235134_cart_reminders_rules.sql` | `20260925000852` |
| `20260925001405_plan_reminders.sql` | `20260925061307` |
| `20260925001406_plan_reminders_rules.sql` | `20260925061434` |
| `20260925071449_wishlists.sql` | `20260925072853` |
| `20260925071450_wishlists_rules.sql` | `20260925072857` |
| `20260925085020_wishlist_cart_adds.sql` | `20260925085949` |
| `20260925085021_wishlist_cart_adds_rules.sql` | `20260925085954` |
| `20260925094805_connection_timeouts.sql` | `20260925094955` |
| `20260925112943_store_locations.sql` | `20260925113202` |
| `20260925112944_store_locations_rules.sql` | `20260925113206` |
| `20260925114152_integrations.sql` | `20260925120038` |
| `20260925114154_integrations_rules.sql` | `20260925120334` |
| `20260925125149_pages.sql` | `20260925132252` |
| `20260925125151_pages_rules.sql` | `20260925132331` |
| `20260925152308_saved_parts.sql` | `20260925153157` |
| `20260925152309_saved_parts_rules.sql` | `20260925153200` |
| `20260925194826_terms.sql` | `20260925200042` |
| `20260925194827_terms_rules.sql` | `20260925200227` |
| `20260925201939_reserve_term_slugs.sql` | `20260925202605` |
| `20260925204337_store_pages.sql` | `20260925204903` |
| `20260925205347_store_front_page.sql` | `20260925210502` |
| `20260925205348_store_front_page_rules.sql` | `20260925210527` |
| `20260925210537_store_front_page_index.sql` | `20260925212346` |
| `20260925215544_store_pages_copy.sql` | `20260925220437` |
| `20260925223418_articles.sql` | `20260925224321` |
| `20260925223419_articles_rules.sql` | `20260925225221` |
| `20260925235530_cookie_consent.sql` | `20260926094645` |
| `20260925235543_cookie_consent_rules.sql` | `20260926095312` |
| `20260926100226_cookie_scans.sql` | `20260926102021` |
| `20260926100228_cookie_scans_rules.sql` | `20260926102036` |
| `20260926103309_fonts.sql` | `20260926110524` |
| `20260926103311_fonts_rules.sql` | `20260926110602` |
| `20260926111946_themes.sql` | `20260926113849` |
| `20260926111947_themes_rules.sql` | `20260926114808` |
| `20260926114922_bold_theme.sql` | `20260926115436` |
| `20260926123242_store_custom_code.sql` | `20260926124343` |
| `20260926135358_store_domains.sql` | `20260926140916` |
| `20260926135430_store_domains_rules.sql` | `20260926140920` |
| `20260926171929_b2b.sql` | `20260926172750` |
| `20260926185247_open_cart_on_add.sql` | `20260926190122` |
| `20260926205250_vat_categories.sql` | `20260926214426` |
| `20260926205252_vat_categories_rules.sql` | `20260926215009` |
| `20260926215234_bookings.sql` | `20260926221754` |
| `20260926215253_bookings_rules.sql` | `20260926221841` |
| `20260926221855_bookings_indexes.sql` | `20260926223228` |
| `20260926223701_bookings_expired_holds.sql` | `20260926225955` |
| `20260926224408_bookings_order_line_idx.sql` | `20260926230005` |
| `20260926230303_booking_reminders.sql` | `20260927002943` |
| `20260926230305_booking_reminders_rules.sql` | `20260927003033` |
| `20260927003723_demo_appointment.sql` | `20260927011301` |
| `20260927095400_pay_later.sql` | `20260927101251` |
| `20260927100129_pay_later_rules.sql` | `20260927102252` |
| `20260927102422_self_service_bookings.sql` | `20260927103728` |
| `20260927103812_no_show.sql` | `20260927104439` |
| `20260927104708_stays_and_rentals.sql` | `20260927111545` |
| `20260927110355_stays_and_rentals_rules.sql` | `20260927111646` |
| `20260927112108_calendar_sync.sql` | `20260927113614` |
| `20260927112110_calendar_sync_rules.sql` | `20260927113654` |
| `20260927113913_rental_periods.sql` | `20260927115721` |
| `20260927113915_rental_periods_rules.sql` | `20260927115932` |
| `20260927120429_seasons_and_fees.sql` | `20260927122101` |
| `20260927120431_seasons_and_fees_rules.sql` | `20260927122220` |
| `20260927122616_hosts.sql` | `20260927124138` |
| `20260927122618_hosts_rules.sql` | `20260927124141` |
| `20260927124357_host_payments.sql` | `20260927130301` |
| `20260927124359_host_payments_rules.sql` | `20260927130304` |
| `20260927130458_dac7.sql` | `20260927131537` |
| `20260927130500_dac7_rules.sql` | `20260927131541` |
| `20260927131826_host_payment_domains.sql` | `20260927132327` |
| `20260927132621_host_commissions_per_payment.sql` | `20260927133331` |
| `20260927133521_payments_kaizen_fee.sql` | `20260927133909` |
| `20260927135959_order_lines_booked_count.sql` | `20260927140411` |
| `20260927142926_season_names.sql` | `20260927144128` |
| `20260927142928_season_names_rules.sql` | `20260927144312` |
| `20260927144802_search_functions.sql` | `20260927151745` |
| `20260927144824_search.sql` | `20260927151751` |
| `20260927144838_search_rules.sql` | `20260927151756` |
| `20260927153005_ai_providers.sql` | `20260927154148` |
| `20260927153007_ai_providers_rules.sql` | `20260927154151` |
| `20260927154453_embeddings.sql` | `20260927160306` |
| `20260927154456_search_meaning.sql` | `20260927160316` |
| `20260927161034_search_filters.sql` | `20260927161949` |
| `20260927162004_embeddings_product_idx.sql` | `20260927162020` |
| `20260927165722_ai_similarity_default.sql` | `20260927170636` |
| `20260927170719_ai_provider_openai_eu.sql` | `20260927171931` |
| `20260927173836_search_cache.sql` | `20260927175020` |
| `20260927173839_search_cache_rules.sql` | `20260927175032` |
| `20260927175352_search_experiments.sql` | `20260927182332` |
| `20260927175354_search_experiments_rules.sql` | `20260927182530` |
| `20260927202914_listing_filters.sql` | `20260927203910` |
| `20260927210852_product_layouts.sql` | `20260927212011` |
| `20260927210919_product_layouts_rules.sql` | `20260927212241` |
| `20260927223709_page_videos_bucket.sql` | `20260927224859` |
| `20260927230021_site_layouts.sql` | `20260927232756` |
| `20260927230023_site_layouts_rules.sql` | `20260927232848` |
| `20260927234312_chat_agents.sql` | `20260928014126` |
| `20260927234314_chat_agents_rules.sql` | `20260928014130` |
| `20260928014202_chat_usage_key.sql` | `20260928014333` |
| `20260928064842_variant_images.sql` | `20260928072857` |
| `20260928064846_variant_images_rules.sql` | `20260928072939` |
| `20260928074718_products_page.sql` | `20260928081541` |
| `20260928074722_products_page_rules.sql` | `20260928081545` |
| `20260928091120_menus.sql` | `20260928102111` |
| `20260928091130_menus_rules.sql` | `20260928102233` |
| `20260928111300_media.sql` | `20260928113550` |
| `20260928111304_media_rules.sql` | `20260928113608` |
| `20260928115257_media_alt_texts.sql` | `20260928121531` |
| `20260928115301_media_alt_texts_rules.sql` | `20260928121559` |
| `20260928122840_media_alt_retry.sql` | `20260928123550` |
| `20260928140700_google_places.sql` | `20260928141845` |
| `20260928140712_google_places_rules.sql` | `20260928141849` |
| `20260928145503_ai_images.sql` | `20260928150504` |
| `20260928161343_form_submissions.sql` | `20260928163635` |
| `20260928161347_form_submissions_rules.sql` | `20260928163644` |
| `20260928172226_owner_assistant.sql` | `20260928173523` |
| `20260928172229_owner_assistant_rules.sql` | `20260928173531` |
| `20260928181938_assistant_kaizen_life.sql` | `20260928184657` |
| `20260928185016_kaizen_life_links.sql` | `20260928190042` |
| `20260928185020_kaizen_life_links_rules.sql` | `20260928190045` |
| `20260928210218_avatars.sql` | `20260928211313` |
| `20260928210221_avatars_bucket.sql` | `20260928211321` |
| `20260928213141_global_parts.sql` | `20260928215312` |
| `20260928221420_color_modes.sql` | `20260928224255` |
| `20260928225339_custom_css.sql` | `20260928232221` |
| `20260928233111_slack.sql` | `20260928233955` |
| `20260929003524_weekly_deliveries.sql` | `20260929011806` |
| `20260929003527_weekly_deliveries_rules.sql` | `20260929011824` |
| `20260929011206_reserve_deliveries_slug.sql` | `20260929011829` |
| `20260929063017_ai_manager.sql` | `20260929065729` |
| `20260929063020_ai_manager_memory.sql` | `20260929065743` |
| `20260929080952_live_voice.sql` | `20260929082958` |
| `20260929084209_ai_usage.sql` | `20260929085900` |
| `20260929113111_customer_tiers_companies.sql` | `20260929114206` |
| `20260929120512_store_languages_currencies.sql` | `20260929124349` |
| `20260929132445_platform_languages.sql` | `20260929134335` |
| `20260929140158_page_roles.sql` | `20260929144434` |
| `20260929140208_page_roles_rules.sql` | `20260929144507` |
| `20260929154525_page_roles_shop.sql` | `20260929160618` |
| `20260929161308_campaigns.sql` | `20260929163338` |
| `20260929163351_campaigns_gift_index.sql` | `20260929163358` |
| `20260929164445_campaign_limits.sql` | `20260929172530` |
| `20260929172917_campaign_countries_per_customer.sql` | `20260929174436` |
| `20260929185842_custom_fields.sql` | `20260929193043` |
| `20260929185909_custom_fields_clone.sql` | `20260929193159` |
| `20260929194449_field_files_bucket.sql` | `20260929201610` |
| `20260929195146_field_entities_search.sql` | `20260929201613` |
| `20260929195204_field_entities_clone.sql` | `20260929201651` |
| `20260929202305_field_entities_more.sql` | `20260929210529` |
| `20260929202311_field_entities_more_rules.sql` | `20260929210606` |
| `20260929211910_work_module.sql` | `20260929223522` |
| `20260929211920_work_rules.sql` | `20260929223714` |
| `20260929224137_work_recurring_skip.sql` | `20260929231341` |
| `20260929232003_work_timer_across_stores.sql` | `20260930070705` |
| `20260929233601_work_imported_invoices.sql` | `20260930070744` |
| `20260930104529_template_sharing.sql` | `20260930112833` |
| `20260930120540_template_page_layouts.sql` | `20260930123609` |
| `20260930150506_store_copy.sql` | `20260930164221` |
| `20260930150511_store_copy_rules.sql` | `20260930164808` |
| `20260930172604_bonus_program.sql` | `20260930182950` |
| `20260930172724_bonus_program_rules.sql` | `20260930183305` |
| `20260930173559_bonus_program_store_copy.sql` | `20260930183509` |
| `20260930184726_affiliate_program.sql` | `20260930200651` |
| `20260930184735_referral_rules.sql` | `20260930203618` |
| `20260930184741_affiliate_rules.sql` | `20260930203812` |
| `20260930214603_plan_features.sql` | `20260930221816` |
| `20260930214609_plan_features_rules.sql` | `20260930221844` |
| `20260930223219_shipping_carriers.sql` | `20260930225643` |
| `20260930223224_shipping_carriers_rules.sql` | `20260930225648` |
| `20260930230448_bring_connection.sql` | `20260930233312` |
| `20260930233801_delivery_options.sql` | `20261001054639` |
| `20260930235415_delivery_options_rules.sql` | `20261001054658` |
| `20261001060947_postnord_prices.sql` | `20261001064035` |
| `20261001064606_porterbuddy_windows.sql` | `20261001065921` |
| `20261001081607_recommendations.sql` | `20261001090734` |
| `20261001081613_recommendations_rules.sql` | `20261001091123` |
| `20261001091947_category_tag_roles.sql` | `20261001094742` |
| `20261001095854_order_number_sequence.sql` | `20261001101811` |
| `20261001120700_platform_page_roles.sql` | `20261001122851` |
| `20261001133549_ai_model_prices.sql` | `20261001135303` |
| `20261001150357_ai_unit_prices.sql` | `20261001150924` |
| `20261001183142_ab_experiments.sql` | `20261001193047` |
| `20261001193645_ab_part_tests.sql` | `20261001195855` |
| `20261001200626_ab_site_tests.sql` | `20261001203321` |
| `20261001223105_ab_working_pages.sql` | `20261002054740` |
| `20261002060621_ab_front_pages.sql` | `20261002060621` (applied by hand with `execute_sql` in four steps, then recorded in `schema_migrations`; `apply_migration` was cancelled) |
| `20261002074358_ab_form_goal.sql` | `20261002080630` |
| `20261002085924_page_replications.sql` | `20261002101028` |
| `20261002085939_page_replications_rules.sql` | `20261002101039` |
| `20261002143618_analytics.sql` | `20261002211542` |
| `20261002143638_analytics_rules.sql` | `20261002213225`, `20261002213304`, `20261002213341`, `20261002213507` (applied in four parts as `analytics_rules_rls`, `_copy_orders`, `_clone_store` and `_duplicate_store`, because one call carrying the whole 48 KB file was cancelled by the tool; `duplicate_store` was changed in place from its live definition, adding `cost_minor` to the variant copy, and is identical to the file's) |
| `20261002215338_returns.sql` | `20261003092409`, `20261003093831` (applied in two parts as `returns_schema_part1` and `_part2`) |
| `20261002215352_returns_rules.sql` | `20261003094223`, `20261003094319`, `20261003095810`, `20261003095849`, `20261003095906`, `20261003095945` (applied in parts as `returns_rules_part1`, `_part2a`, `_part3_returns`, `_part4a_lines`, `_part4b_clone_store` and `_part4c_duplicate_store`).
`commerce.expire_withdrawal_requests()` (its part 2b) was not applied by the migration tool, whose check cancelled the function's `DELETE` statements three times even after the owner's approval; the owner applied it from the SQL editor (2026-10-03) and its definition in production was checked against the migration file (same body). |
| `20261002224038_returns_instructions_i18n.sql` | `20261003100007` |
| `20261002225439_reserve_withdraw_slug.sql` | `20261003100017` |
| `20261003193641_tax_engine.sql` | `20261004095939` |
| `20261003193902_tax_engine_rules.sql` | `20261004101231`, `20261004101301`, `20261004101318`, `20261004103346`, `20261004103355`, `20261004103406`, `20261004103436`, `20261004103500`, `20261004103525`, `20261004103547`, `20261004103606`, `20261004103627` (applied in twelve parts, `tax_engine_rules_*`, because the migration tool cancelled the whole file and several of its multi-statement parts). **One statement was never applied: the label update of Germany's accommodation rate (`source`,
`checked_on`, `note` of `vat_rates` for DE/accommodation); the history trigger now forbids it, so that row keeps the seed's source text 'Kaizen seed, September 2026 (not verified)' and its 2026-09-26 check date, which is true.** |
| `20261003194725_legal_terms.sql` | `20261004113521` |
| `20261003194748_legal_terms_rules.sql` | `20261004113850`, `20261004114542` (applied in two parts, `legal_terms_rules_part1` and `_part2_experiments_guard`) |
| `20261003195103_staff_security.sql` | `20261004120112` |
| `20261003195109_staff_security_rules.sql` | `20261004121302`, `20261004121336`, `20261004121924`, `20261004121940` (applied in parts: `staff_security_rules_part1_recovery_codes`, `_part2_audit_area_of`, `_part3a_audit_guard_function` and `_part3c_audit_guard_trigger`). **Two statements were not applied by the migration tool, which cancels them: `DROP TRIGGER audit_log_append_only ON commerce.audit_log;` and the one-off backfill of `audit_log.area`.
The owner ran both in the SQL editor on 2026-10-04, and production was checked afterwards: only `audit_log_guard` is left on the table and no row has a null area.** |
| `20261003203141_store_role_templates.sql` | `20261004121233` |
| `20261004111101_plan_features_wave1.sql` | `20261004122015` |
| `20261004125309_order_invoices.sql` (order_invoices_part1_tables) | `20261004161504` |
| `20261004125309_order_invoices.sql` (order_invoices_part2_columns) | `20261004161521` |
| `20261004125309_order_invoices.sql` (order_invoices_part3_keys_indexes) | `20261004161533` |
| `20261004125309_order_invoices.sql` (order_invoices_part4_checks) | `20261004161548` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p1_helpers) | `20261004161742` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p2_series_settings) | `20261004161754` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p3_guards) | `20261004161820` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p4_eligibility) | `20261004161842` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p5_snapshot) | `20261004161916` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p6_make_invoice) | `20261004161943` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p7_credit_note) | `20261004162128` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p8_queue_audit) | `20261004162157` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p9_patch_payment) | `20261004162212` |
| `20261004125337_order_invoices_rules.sql` (order_invoices_rules_p10_patch_duplicate) | `20261004162216` |
| `20261004152302_order_invoices_fixes.sql` (order_invoices_fixes) | `20261004162227` |
| `20261004125343_order_invoices_audit.sql` (order_invoices_audit) | `20261004162305` |
| `20261004164607_tax_reports.sql` (tax_reports) | `20261004203138` |
| `20261004164617_tax_reports_rules.sql` (p1, p2_document_groups) | `20261004203147`, `20261004203205` |
| `20261004171452_unit_price.sql` (unit_price) | `20261004203226` |
| `20261004171501_unit_price_rules.sql` (p1, p2 to p4: the three patches) | `20261004203244`, `20261004203251`, `20261004203302`, `20261004203305` |
| `20261004174355_gdpr.sql` (gdpr) | `20261004205535` |
| `20261004174402_gdpr_rules.sql` (p1_retention_rules, p2_patches, p3_orders) | `20261004210030`, `20261004210055`, `20261004210120` |
| `20261004174410_gdpr_audit.sql` (gdpr_audit) | `20261004210139` |
| `20261004214349_ai_vision_model.sql` (ai_vision_model) | `20261004215434` |
| `20261002165344_analytics_indexes.sql` | `20261002213235` |

The template store was seeded from `supabase/seed.sql`, and the existing owner
account was carried over as platform admin and owner of the template store.

Supabase records each migration with the version it was applied at, not the
timestamp in the file name. This does not matter while migrations are applied
through Supabase's API. If the Supabase CLI is adopted later (for example for
branching), run `supabase migration repair` once to align the history.
