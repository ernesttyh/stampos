-- The loyalty functions must only be callable by the server (service role), never via the public anon key.
-- (Supabase's security advisor flags SECURITY DEFINER functions that anon/authenticated can execute.)
revoke execute on function public.add_stamps(uuid, int, text, uuid, uuid, int, text, boolean) from public, anon, authenticated;
revoke execute on function public.redeem_reward(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.brand_stats(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.add_stamps(uuid, int, text, uuid, uuid, int, text, boolean) to service_role;
grant execute on function public.redeem_reward(text, uuid, uuid) to service_role;
grant execute on function public.brand_stats(uuid) to service_role;
