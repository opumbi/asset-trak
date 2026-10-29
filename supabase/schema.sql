-- =============================================================================
-- Asset Track — Supabase PostgreSQL Schema, Storage Bucket & RLS Policies
-- Run this script once in your Supabase SQL Editor.
-- =============================================================================

-- 1. Tracked Corporate Assets Table
create table if not exists public.assets (
  asset_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  serial_number text not null check (char_length(serial_number) between 1 and 80),
  category text not null check (
    category in (
      'IT Hardware',
      'Office Furniture',
      'Vehicles',
      'Machinery',
      'Lab & Medical',
      'Other'
    )
  ),
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0 and purchase_price <= 1000000000),
  current_valuation numeric(14, 2) not null default 0 check (current_valuation >= 0 and current_valuation <= 1000000000),
  purchase_date text not null check (purchase_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  warranty_expiry text not null default '',
  status text not null check (
    status in ('In Use', 'Available', 'Maintenance', 'Disposed')
  ),
  department text not null check (char_length(department) between 1 and 80),
  location text not null check (char_length(location) between 1 and 120),
  assigned_to text not null default '' check (char_length(assigned_to) <= 100),
  notes text not null default '' check (char_length(notes) <= 1000),
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assets_owner_updated
  on public.assets (owner_id, updated_at desc);

create index if not exists idx_assets_serial_number
  on public.assets (owner_id, serial_number);

-- 2. Immutable Asset Audit Events Table
create table if not exists public.asset_events (
  event_id text primary key,
  asset_id text not null references public.assets(asset_id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (
    action in (
      'Asset Registered',
      'Details Updated',
      'Status Changed',
      'Valuation Adjusted',
      'Photo Updated'
    )
  ),
  summary text not null check (char_length(summary) between 1 and 300),
  actor_email text not null check (char_length(actor_email) between 3 and 160),
  created_at timestamptz not null default now()
);

create index if not exists idx_asset_events_asset_created
  on public.asset_events (asset_id, created_at desc);

-- 3. Enable Row Level Security (RLS)
alter table public.assets enable row level security;
alter table public.asset_events enable row level security;

-- Assets RLS Policies (Owner-Isolated + Terminal Disposed Lock)
drop policy if exists "Owners can view their own assets" on public.assets;
create policy "Owners can view their own assets"
  on public.assets for select
  using (auth.uid() = owner_id);

drop policy if exists "Owners can insert their own assets" on public.assets;
create policy "Owners can insert their own assets"
  on public.assets for insert
  with check (auth.uid() = owner_id);

drop policy if exists "Owners can update non-disposed assets" on public.assets;
create policy "Owners can update non-disposed assets"
  on public.assets for update
  using (auth.uid() = owner_id and status <> 'Disposed')
  with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete their own assets" on public.assets;
create policy "Owners can delete their own assets"
  on public.assets for delete
  using (auth.uid() = owner_id);

-- Asset Events RLS Policies (Append-Only Audit Log)
drop policy if exists "Owners can view their own asset events" on public.asset_events;
create policy "Owners can view their own asset events"
  on public.asset_events for select
  using (auth.uid() = owner_id);

drop policy if exists "Owners can insert their own asset events" on public.asset_events;
create policy "Owners can insert their own asset events"
  on public.asset_events for insert
  with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete their own asset events" on public.asset_events;
create policy "Owners can delete their own asset events"
  on public.asset_events for delete
  using (auth.uid() = owner_id);

-- 4. Supabase Storage Bucket for High-Resolution Asset Photographs
insert into storage.buckets (id, name, public)
values ('asset-photos', 'asset-photos', true)
on conflict (id) do nothing;

drop policy if exists "Public read access for asset photos" on storage.objects;
create policy "Public read access for asset photos"
  on storage.objects for select
  using (bucket_id = 'asset-photos');

drop policy if exists "Authenticated users upload asset photos" on storage.objects;
create policy "Authenticated users upload asset photos"
  on storage.objects for insert
  with check (
    bucket_id = 'asset-photos'
    and auth.role() = 'authenticated'
  );
