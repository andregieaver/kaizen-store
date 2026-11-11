-- D275 (docs/themes-content-and-demo-stores.md): each of Kaizena Flow's launch themes takes one content pack's template as its own content,
-- the store its preview and photographs draw and new stores started from it are copied from. No two themes share one; Signal takes
-- Electronics (its own look was shown on Fashion, as Calm's is). syncLaunchThemes() keeps the same links from LAUNCH_THEMES.content.
update commerce.store_starters st
   set design_preset_id = p.id
  from commerce.design_presets p,
       (values ('calm', 'fashion'), ('hearth', 'food'), ('signal', 'electronics'), ('fjord', 'home'),
               ('orbit', 'astronomy'), ('atelier', 'ceramics'), ('arcade', 'neon'), ('botanica', 'plants')) as m(theme, pack)
 where p.launch_key = m.theme
   and st.pack_key = m.pack
   and st.design_preset_id is null
   and not exists (select 1 from commerce.store_starters o where o.design_preset_id = p.id);
