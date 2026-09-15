-- Ink Stories — Supabase schema, storage, and RLS setup.
-- Run this once, in full, in your Supabase project's SQL editor
-- (Dashboard → SQL Editor → New query) for a fresh project.

-- 1. Submissions table -------------------------------------------------

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  photo_path text not null,
  audio_path text not null,
  phone text,
  email text,
  instagram text,
  consent text not null check (consent in ('private', 'feature')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  constraint at_least_one_contact check (
    coalesce(phone, '') <> '' or coalesce(email, '') <> '' or coalesce(instagram, '') <> ''
  )
);

alter table public.submissions enable row level security;

-- Public flow: anyone can submit a new story, but only ever as 'pending' —
-- they can never set status themselves on insert, and they can never
-- read anything back (no select policy for anon).
create policy "public can insert pending submissions"
  on public.submissions for insert
  to anon
  with check (status = 'pending');

-- Admin: any authenticated user can review and update submissions.
-- Create admin accounts by hand in Supabase Auth — see README.md —
-- there's no public sign-up in this app.
create policy "authenticated can read submissions"
  on public.submissions for select
  to authenticated
  using (true);

create policy "authenticated can update submissions"
  on public.submissions for update
  to authenticated
  using (true)
  with check (status in ('pending', 'approved', 'rejected'));

-- 2. Storage bucket for photos + audio ----------------------------------

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

-- Public flow can upload, but never read, list, update, or overwrite
-- existing files.
create policy "public can upload submission files"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'submissions');

-- Admin can read files (needed to generate signed URLs for review).
create policy "authenticated can read submission files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'submissions');
