# Where the reviewers stand (2026-11-12 00:30 UTC)

| Area | Read (audit) | Challenged (verify) | Planned |
|---|---|---|---|
| storefront-client | done | done | done |
| storefront-data | done | done | to do |
| admin-client | done | done | done |
| admin-data | done | done | done |
| caching | done | done | to do |
| cron | done | done | done |
| db-queries | done | done | done |
| db-schema | done | done | to do |
| deps | done | done | to do |
| assets | done | done | to do |
| ai-context | done | done | to do |
| features | done | done | done |
| families | done | done | to do |
| docs-context | done | done | to do |
| page-model | done | to do | to do |
| css | done | done | to do |
| i18n | done | to do | to do |
| tests-ci | done | done | to do |
| functions | done | to do | to do |
| server-graph | done | to do | to do |
| client-bundles | done | to do | to do |
| page-payload | done | done | to do |
| prefetch | done | to do | to do |
| unused-code | done | to do | to do |
| copied-code | done | done | done |

Done: 7 of 25 areas through all three stages; 18 challenged; 25 read.

To relaunch what is left, pass these args to the workflow (split the keys over several launches of three or four):

```json
{"keys":["storefront-data","caching","db-schema","deps","assets","ai-context","families","docs-context","page-model","css","i18n","tests-ci","functions","server-graph","client-bundles","page-payload","prefetch","unused-code"],"audited":["storefront-client","storefront-data","admin-client","admin-data","caching","cron","db-queries","db-schema","deps","assets","ai-context","features","families","docs-context","page-model","css","i18n","tests-ci","functions","server-graph","client-bundles","page-payload","prefetch","unused-code","copied-code"],"verified":["storefront-client","storefront-data","admin-client","admin-data","caching","cron","db-queries","db-schema","deps","assets","ai-context","features","families","docs-context","css","tests-ci","page-payload","copied-code"]}
```
