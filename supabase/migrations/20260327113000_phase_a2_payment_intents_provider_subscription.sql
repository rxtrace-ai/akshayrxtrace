alter table if exists public.payment_intents
  add column if not exists provider text;

alter table if exists public.payment_intents
  add column if not exists provider_subscription_id text;

alter table if exists public.payment_intents
  add column if not exists provider_customer_id text;

update public.payment_intents
set provider = coalesce(nullif(btrim(provider), ''), 'razorpay')
where provider is null or btrim(provider) = '';

create unique index if not exists payment_intents_provider_subscription_id_key
  on public.payment_intents(provider_subscription_id)
  where provider_subscription_id is not null;
