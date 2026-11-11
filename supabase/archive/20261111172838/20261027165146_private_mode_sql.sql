-- Private mode (D339, wave 7 unit E, docs/wave-7-storefront.md E). Decision 5: a new store is private until it opens, and stores still in
-- setup today become private; an open store is never made private by this change, and a store template or demo store never is (the theme
-- store previews them). The column's default (on) covers every store made from now on, copies included; a copy takes no password.
update commerce.stores
   set private_mode = false
 where setup_completed_at is not null or is_template or starter;
