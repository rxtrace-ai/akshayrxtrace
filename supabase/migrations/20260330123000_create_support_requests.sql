create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  company_id uuid null references public.companies(id) on delete set null,
  full_name text not null,
  company_name text null,
  email text not null,
  category text not null,
  priority text not null default 'normal',
  message text not null,
  status text not null default 'open',
  source text not null default 'dashboard_help',
  created_at timestamptz not null default now()
);

create index if not exists support_requests_created_at_idx
  on public.support_requests (created_at desc);

create index if not exists support_requests_status_idx
  on public.support_requests (status, created_at desc);

create index if not exists support_requests_company_idx
  on public.support_requests (company_id, created_at desc);

alter table public.support_requests enable row level security;
