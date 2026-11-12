# Where the reviewers stand (2026-11-12 01:19 UTC)

| Area | Read (audit) | Challenged (verify) | Planned |
|---|---|---|---|
| storefront-client | done | done | done |
| storefront-data | done | done | done |
| admin-client | done | done | done |
| admin-data | done | done | done |
| caching | done | done | done |
| cron | done | done | done |
| db-queries | done | done | done |
| db-schema | done | done | done |
| deps | done | done | done |
| assets | done | done | done |
| ai-context | done | done | done |
| features | done | done | done |
| families | done | done | done |
| docs-context | done | done | done |
| page-model | done | done | done |
| css | done | done | done |
| i18n | done | done | done |
| tests-ci | done | done | done |
| functions | done | done | to do |
| server-graph | done | done | to do |
| client-bundles | done | done | to do |
| page-payload | done | done | done |
| prefetch | done | done | to do |
| unused-code | done | done | done |
| copied-code | done | done | done |

Done: 21 of 25 areas through all three stages; 25 challenged; 25 read.

To relaunch what is left, pass these args to the workflow (split the keys over several launches of three or four):

```json
{"keys":["functions","server-graph","client-bundles","prefetch"],"audited":["storefront-client","storefront-data","admin-client","admin-data","caching","cron","db-queries","db-schema","deps","assets","ai-context","features","families","docs-context","page-model","css","i18n","tests-ci","functions","server-graph","client-bundles","page-payload","prefetch","unused-code","copied-code"],"verified":["storefront-client","storefront-data","admin-client","admin-data","caching","cron","db-queries","db-schema","deps","assets","ai-context","features","families","docs-context","page-model","css","i18n","tests-ci","functions","server-graph","client-bundles","page-payload","prefetch","unused-code","copied-code"]}
```
