-- The mirror two_step_since now decides when the Auth call may be skipped (bloat review step 2.33), so it must be right for accounts that exist today: set it for every account with a verified factor. It is only set, never cleared.
do $$
begin
  if to_regclass('auth.mfa_factors') is not null then
    update commerce.accounts a set two_step_since = now()
    where a.two_step_since is null
      and a.auth_user_id is not null
      and exists (select 1 from auth.mfa_factors f where f.user_id = a.auth_user_id and f.status = 'verified');
  end if;
exception when insufficient_privilege then
  raise notice 'two-step mirror reconcile skipped: no read on auth.mfa_factors';
end $$;
