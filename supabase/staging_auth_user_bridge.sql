-- Staging-only additive bridge. Existing custom sessions continue until API cutover.
alter table public.users alter column password_hash drop not null;
alter table public.users alter column password_salt drop not null;

create or replace function public.evia_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := new.id::text;
  nick text := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name','')), '');
  dob text := nullif(new.raw_user_meta_data->>'date_of_birth','');
  ts text := coalesce(new.created_at::text, now()::text);
begin
  insert into public.users(id,email,display_name,password_hash,password_salt,created_at,date_of_birth)
  values(uid,coalesce(new.email,''),coalesce(nick,'friend'),null,null,ts,dob)
  on conflict (id) do nothing;
  insert into public.skin_profiles(user_id,updated_at)
  values(uid,ts)
  on conflict (user_id) do nothing;
  insert into public.preferences(user_id,voice_enabled,updated_at)
  values(uid,0,ts)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.evia_auth_user_created() from public, anon, authenticated;
drop trigger if exists evia_auth_user_created on auth.users;
create trigger evia_auth_user_created
after insert on auth.users
for each row execute function public.evia_auth_user_created();
