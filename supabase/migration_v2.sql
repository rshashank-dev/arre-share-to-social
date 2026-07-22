-- Run this in Supabase SQL Editor (after migration.sql is already applied)
-- Creates: ai_accounts, engagement_cache
-- Then disables RLS on both

CREATE TABLE IF NOT EXISTS ai_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       TEXT NOT NULL UNIQUE,   -- matches arre_user_id in share_jobs / social_tokens
  display_name     TEXT,                   -- human-readable name e.g. "Tamil Poetry Bot"
  category         TEXT,                   -- e.g. "Poetry", "News", "Music"
  language         TEXT,                   -- e.g. "Tamil", "Hindi", "Telugu"
  ig_username      TEXT,
  yt_channel_name  TEXT,
  ig_connected     BOOLEAN DEFAULT FALSE,
  yt_connected     BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engagement_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID REFERENCES share_jobs(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube')),
  metric      TEXT NOT NULL,
  -- Instagram metrics: reach, impressions, likes, comments, shares, saved, profile_visits
  -- YouTube metrics:   views, likes, comments, watch_time_minutes, subscribers_gained
  value       BIGINT DEFAULT 0,
  pulled_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_job      ON engagement_cache (job_id);
CREATE INDEX IF NOT EXISTS idx_engagement_platform ON engagement_cache (platform);
CREATE INDEX IF NOT EXISTS idx_engagement_pulled   ON engagement_cache (pulled_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_jobs_platform ON share_jobs (platform);
CREATE INDEX IF NOT EXISTS idx_share_jobs_created  ON share_jobs (created_at DESC);

ALTER TABLE ai_accounts       DISABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_cache  DISABLE ROW LEVEL SECURITY;
