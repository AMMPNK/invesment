-- Focus HUD · Supabase schema
-- Run this in your Supabase project SQL editor BEFORE first sync.

-- ============================================================
-- 1. workspaces
-- ============================================================
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  ws_key text not null check (ws_key in ('work', 'life')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, ws_key)
);

-- ============================================================
-- 2. journals
-- ============================================================
create table if not exists public.journals (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  date text not null,
  ws text not null check (ws in ('work', 'life')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists journals_user_date_idx on public.journals (user_id, date desc);

-- ============================================================
-- 3. Row Level Security
-- ============================================================
alter table public.workspaces enable row level security;
alter table public.journals enable row level security;

drop policy if exists "workspaces are user-scoped" on public.workspaces;
create policy "workspaces are user-scoped" on public.workspaces
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "journals are user-scoped" on public.journals;
create policy "journals are user-scoped" on public.journals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 4. updated_at auto-bump trigger (defensive — clients send updated_at,
--    but trigger ensures consistency).
-- ============================================================
create or replace function public.bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.bump_updated_at();

drop trigger if exists trg_journals_updated_at on public.journals;
create trigger trg_journals_updated_at
  before update on public.journals
  for each row execute function public.bump_updated_at();
