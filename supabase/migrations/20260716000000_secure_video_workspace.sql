create extension if not exists pgcrypto;

create table if not exists public.video_briefs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  purpose text default '',
  target_audience text default '',
  plan_month text not null,
  category text not null default '公司日常',
  status text not null default 'draft',
  expected_publish_at timestamptz,
  script_mode text default '',
  script_content text default '',
  script_table jsonb default '[]'::jsonb,
  script_at timestamptz,
  materials_at timestamptz,
  materials_confirmed_at timestamptz,
  editing_at timestamptz,
  completed_at timestamptz,
  editor_name text default '',
  editor_userid text default '',
  editor_assigned_at timestamptz,
  sent_to_editor_at timestamptz,
  final_video_name text default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.video_briefs(id) on delete cascade,
  kind text not null default 'asset',
  file_name text not null,
  name text generated always as (file_name) stored,
  file_path text not null,
  path text generated always as (file_path) stored,
  file_size bigint default 0,
  mime_type text default '',
  public_url text default '',
  url text generated always as (public_url) stored,
  uploaded_by uuid not null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.final_videos (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.video_briefs(id) on delete cascade,
  file_name text not null,
  name text generated always as (file_name) stored,
  file_path text not null,
  path text generated always as (file_path) stored,
  file_size bigint default 0,
  mime_type text default '',
  public_url text default '',
  url text generated always as (public_url) stored,
  uploaded_by uuid not null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists video_briefs_month_idx on public.video_briefs(plan_month);
create index if not exists video_briefs_category_idx on public.video_briefs(category);
create index if not exists video_briefs_status_idx on public.video_briefs(status);
create index if not exists video_briefs_owner_idx on public.video_briefs(created_by);
create index if not exists media_assets_brief_idx on public.media_assets(brief_id);
create index if not exists media_assets_owner_idx on public.media_assets(uploaded_by);
create index if not exists final_videos_brief_idx on public.final_videos(brief_id);
create index if not exists final_videos_owner_idx on public.final_videos(uploaded_by);

alter table public.video_briefs enable row level security;
alter table public.media_assets enable row level security;
alter table public.final_videos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='video_briefs' and policyname='video_briefs_owner_select') then create policy video_briefs_owner_select on public.video_briefs for select to authenticated using (created_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='video_briefs' and policyname='video_briefs_owner_insert') then create policy video_briefs_owner_insert on public.video_briefs for insert to authenticated with check (created_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='video_briefs' and policyname='video_briefs_owner_update') then create policy video_briefs_owner_update on public.video_briefs for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='video_briefs' and policyname='video_briefs_owner_delete') then create policy video_briefs_owner_delete on public.video_briefs for delete to authenticated using (created_by = auth.uid()); end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='media_assets' and policyname='media_assets_owner_select') then create policy media_assets_owner_select on public.media_assets for select to authenticated using (uploaded_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='media_assets' and policyname='media_assets_owner_insert') then create policy media_assets_owner_insert on public.media_assets for insert to authenticated with check (uploaded_by = auth.uid() and exists (select 1 from public.video_briefs b where b.id = brief_id and b.created_by = auth.uid())); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='media_assets' and policyname='media_assets_owner_update') then create policy media_assets_owner_update on public.media_assets for update to authenticated using (uploaded_by = auth.uid()) with check (uploaded_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='media_assets' and policyname='media_assets_owner_delete') then create policy media_assets_owner_delete on public.media_assets for delete to authenticated using (uploaded_by = auth.uid()); end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='final_videos' and policyname='final_videos_owner_select') then create policy final_videos_owner_select on public.final_videos for select to authenticated using (uploaded_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='final_videos' and policyname='final_videos_owner_insert') then create policy final_videos_owner_insert on public.final_videos for insert to authenticated with check (uploaded_by = auth.uid() and exists (select 1 from public.video_briefs b where b.id = brief_id and b.created_by = auth.uid())); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='final_videos' and policyname='final_videos_owner_update') then create policy final_videos_owner_update on public.final_videos for update to authenticated using (uploaded_by = auth.uid()) with check (uploaded_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='final_videos' and policyname='final_videos_owner_delete') then create policy final_videos_owner_delete on public.final_videos for delete to authenticated using (uploaded_by = auth.uid()); end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('video-materials', 'video-materials', false, 524288000, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm','application/pdf','text/plain']::text[]),
  ('final-videos', 'final-videos', false, 1073741824, array['video/mp4','video/quicktime','video/webm']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='video_workspace_owner_select') then create policy video_workspace_owner_select on storage.objects for select to authenticated using (bucket_id in ('video-materials','final-videos') and (storage.foldername(name))[1] = auth.uid()::text); end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='video_workspace_owner_insert') then create policy video_workspace_owner_insert on storage.objects for insert to authenticated with check (bucket_id in ('video-materials','final-videos') and (storage.foldername(name))[1] = auth.uid()::text); end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='video_workspace_owner_update') then create policy video_workspace_owner_update on storage.objects for update to authenticated using (bucket_id in ('video-materials','final-videos') and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id in ('video-materials','final-videos') and (storage.foldername(name))[1] = auth.uid()::text); end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='video_workspace_owner_delete') then create policy video_workspace_owner_delete on storage.objects for delete to authenticated using (bucket_id in ('video-materials','final-videos') and (storage.foldername(name))[1] = auth.uid()::text); end if;
end $$;
