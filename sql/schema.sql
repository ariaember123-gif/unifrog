-- Run this once against your Vercel Postgres database
-- (Vercel dashboard -> Storage -> your Postgres DB -> Query tab, paste + run)

CREATE TABLE IF NOT EXISTS memes (
  id          BIGSERIAL PRIMARY KEY,
  image_url   TEXT NOT NULL,
  thumb_url   TEXT,                     -- reserved for future thumbnail generation
  uploader    VARCHAR(40) NOT NULL DEFAULT 'Anon Frog',
  caption     VARCHAR(280) NOT NULL DEFAULT '',
  likes       INTEGER NOT NULL DEFAULT 0,
  ip_hash     VARCHAR(64),               -- sha256 of uploader IP, for basic rate limiting/moderation
  status      VARCHAR(16) NOT NULL DEFAULT 'approved', -- 'approved' | 'pending' | 'rejected'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memes_created_at ON memes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memes_likes ON memes (likes DESC);
CREATE INDEX IF NOT EXISTS idx_memes_status ON memes (status);

-- Basic rate-limit helper table: one row per IP hash, tracks last upload time + count today
CREATE TABLE IF NOT EXISTS upload_limits (
  ip_hash       VARCHAR(64) PRIMARY KEY,
  last_upload   TIMESTAMPTZ NOT NULL DEFAULT now(),
  count_today   INTEGER NOT NULL DEFAULT 0,
  day_marker    DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Shared Hop Race leaderboard: top scores from every visitor, not just one browser
CREATE TABLE IF NOT EXISTS leaderboard (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(12) NOT NULL DEFAULT 'FROG',
  score       INTEGER NOT NULL,
  ip_hash     VARCHAR(64),               -- sha256 of submitter IP, for basic abuse tracking
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard (score DESC, created_at ASC);
