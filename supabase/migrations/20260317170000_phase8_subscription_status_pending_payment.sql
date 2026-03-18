-- Phase 8: lifecycle state alignment for company_subscriptions.
-- Ensure pending_payment is accepted as an intermediate state.

do $$
declare
  con_name text;
begin
  select c.conname
  into con_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'company_subscriptions'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%';

  if con_name is not null then
    execute format('alter table public.company_subscriptions drop constraint if exists %I', con_name);
  end if;

  alter table public.company_subscriptions
    add constraint company_subscriptions_status_check
    check (status in ('active', 'pending', 'pending_payment', 'expired', 'cancelled'));
end $$;

