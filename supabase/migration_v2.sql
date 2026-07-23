-- migration_v2.sql
-- Run AFTER migration.sql is already applied.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS).

-- ── 1. ai_accounts ────────────────────────────────────────────────────────────
-- Keyed by category (e.g. "Poetry", "News") not creator_id.
-- One row per category — maps to 1 IG account + 1 YT channel.
-- social_tokens stores the actual OAuth tokens, keyed by category name in arre_user_id.

CREATE TABLE IF NOT EXISTS ai_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category         TEXT        NOT NULL UNIQUE,  -- e.g. "Poetry", "News", "Music"
  display_name     TEXT,                          -- friendly name for dashboard
  ig_username      TEXT,                          -- @handle of the category's IG account
  yt_channel_name  TEXT,                          -- name of the category's YT channel
  ig_connected     BOOLEAN     DEFAULT FALSE,
  yt_connected     BOOLEAN     DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Add category + language to share_jobs ──────────────────────────────────
-- category: which of the 17 category accounts this job is for
-- language: which language bot (Tamil | Hinglish | English) created the pod

ALTER TABLE share_jobs
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT;

-- ── 3. engagement_cache ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagement_cache (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id    UUID        REFERENCES share_jobs(id) ON DELETE CASCADE,
  platform  TEXT        NOT NULL CHECK (platform IN ('instagram', 'youtube')),
  metric    TEXT        NOT NULL,
  value     BIGINT      DEFAULT 0,
  pulled_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_share_jobs_category ON share_jobs (category);
CREATE INDEX IF NOT EXISTS idx_share_jobs_language ON share_jobs (language);
CREATE INDEX IF NOT EXISTS idx_share_jobs_platform ON share_jobs (platform);
CREATE INDEX IF NOT EXISTS idx_share_jobs_created  ON share_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_job      ON engagement_cache (job_id);
CREATE INDEX IF NOT EXISTS idx_engagement_platform ON engagement_cache (platform);

-- ── 5. Disable RLS on new tables ─────────────────────────────────────────────
ALTER TABLE ai_accounts      DISABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_cache DISABLE ROW LEVEL SECURITY;
