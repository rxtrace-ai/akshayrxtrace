alter table public.payment_intents
add column if not exists correlation_id text;

create unique index if not exists payment_intents_correlation_id_key
on public.payment_intents(correlation_id);
