alter table public.payment_intents
add column if not exists updated_at timestamptz default now();

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_payment_intents_updated_at on public.payment_intents;

create trigger set_payment_intents_updated_at
before update on public.payment_intents
for each row
execute function public.set_updated_at();
