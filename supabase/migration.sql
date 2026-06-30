-- Run this in Supabase SQL editor (ypcpyjlidtmeoenviare.supabase.co)

create extension if not exists "pgcrypto";

create table if not exists social_tokens (
  id                uuid primary key default gen_random_uuid(),
  arre_user_id      text not null,
  platform          text not null check (platform in ('instagram', 'youtube')),
  platform_user_id  text not null,
  username           text,
  access_token      text not null,
  refresh_token     text,
  expires_at        timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (arre_user_id, platform)
);

create table if not exists share_jobs (
  id              uuid primary key default gen_random_uuid(),
  arre_user_id    text not null,
  pod_id          text not null,
  platform        text not null check (platform in ('instagram', 'youtube')),
  format          text not null check (format in ('reel', 'post', 'story', 'shorts')),
  status          text not null default 'queued' check (status in ('queued', 'processing', 'success', 'failed')),
  step            text,
  audio_url       text not null,
  image_url       text not null,
  audiogram_url   text,
  post_url        text,
  error_code      text,
  error_message   text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_share_jobs_user on share_jobs (arre_user_id);
create index if not exists idx_social_tokens_user on social_tokens (arre_user_id);
