alter table if exists public.add_ons
  add column if not exists duration_days integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'add_ons_duration_days_check'
      and conrelid = 'public.add_ons'::regclass
  ) then
    alter table public.add_ons
      add constraint add_ons_duration_days_check
      check (duration_days is null or duration_days in (30, 60, 90));
  end if;
end $$;

comment on column public.add_ons.duration_days is
'For structural capacity add-ons, the number of active days granted after activation. Null for code add-ons.';
