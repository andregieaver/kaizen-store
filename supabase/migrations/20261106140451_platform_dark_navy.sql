-- Kaizena Flow's own site reads in dark mode again (D472; the live accessibility scan of the front page, failing since 4 November 2026).
-- D408 gave the site's highlighted words (`.green-text`, `.super-heading.dark-color`) a light colour in dark mode where no light row is behind
-- them. When the site's accent turned from green to navy (the *Colour* text style, 4 November), that dark-mode colour was set to the navy
-- itself, #2A2A72: on the page's own dark background (#262522) it reads at 1.22:1. It becomes a light tint of the same navy, #9E9EDB (6.1:1
-- on #262522, 7.1:1 on #171717, 5.0:1 even on the navy), and the *Colour* text style's words (`.ts-colour`) take it too where no light row
-- is behind them. The site's CSS and Kaizena Flow's own store's copy of it (D469) keep their versions before the change (D305); a database
-- without these rules is left as it is.

INSERT INTO commerce.css_versions (store_id, css, created_by, created_at)
SELECT NULL, s.custom_css, NULL, clock_timestamp()
  FROM commerce.platform_settings s
 WHERE strpos(s.custom_css, $old$.super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$old$) > 0;
--> statement-breakpoint
INSERT INTO commerce.css_versions (store_id, css, created_by, created_at)
SELECT s.id, s.custom_css, NULL, clock_timestamp()
  FROM commerce.stores s
 WHERE s.house AND strpos(s.custom_css, $old$.super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$old$) > 0;
--> statement-breakpoint
UPDATE commerce.platform_settings SET custom_css = replace(replace(replace(custom_css,
    $a$:root[data-color-mode="dark"] .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$a$,
    $b$:root[data-color-mode="dark"] .super-heading.dark-color:not(.kz-on-light .super-heading),
:root[data-color-mode="dark"] .ts-colour:not(.kz-on-light .ts-colour){
color:#9E9EDB;$b$),
    $c$:root:not([data-color-mode="light"]) .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$c$,
    $d$:root:not([data-color-mode="light"]) .super-heading.dark-color:not(.kz-on-light .super-heading),
:root:not([data-color-mode="light"]) .ts-colour:not(.kz-on-light .ts-colour){
color:#9E9EDB;$d$),
    $e$/* Dark mode: the green words where no light row is behind them (D408). */$e$,
    $f$/* Dark mode: the highlighted words where no light row is behind them, in a light tint of the site's navy (D408, D472). */$f$)
 WHERE strpos(custom_css, $old$.super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$old$) > 0;
--> statement-breakpoint
UPDATE commerce.stores SET custom_css = replace(replace(replace(custom_css,
    $a$:root[data-color-mode="dark"] .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$a$,
    $b$:root[data-color-mode="dark"] .super-heading.dark-color:not(.kz-on-light .super-heading),
:root[data-color-mode="dark"] .ts-colour:not(.kz-on-light .ts-colour){
color:#9E9EDB;$b$),
    $c$:root:not([data-color-mode="light"]) .super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$c$,
    $d$:root:not([data-color-mode="light"]) .super-heading.dark-color:not(.kz-on-light .super-heading),
:root:not([data-color-mode="light"]) .ts-colour:not(.kz-on-light .ts-colour){
color:#9E9EDB;$d$),
    $e$/* Dark mode: the green words where no light row is behind them (D408). */$e$,
    $f$/* Dark mode: the highlighted words where no light row is behind them, in a light tint of the site's navy (D408, D472). */$f$)
 WHERE house AND strpos(custom_css, $old$.super-heading.dark-color:not(.kz-on-light .super-heading){
color:#2A2A72;$old$) > 0;
