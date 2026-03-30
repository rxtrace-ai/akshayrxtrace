create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text not null,
  email text not null,
  phone text not null,
  message text null,
  source text not null default 'landing',
  ip text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists demo_requests_created_at_idx
  on public.demo_requests (created_at desc);

create index if not exists demo_requests_source_idx
  on public.demo_requests (source, created_at desc);

alter table public.demo_requests enable row level security;
