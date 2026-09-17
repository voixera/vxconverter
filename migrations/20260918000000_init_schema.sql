-- VX Converter: Initial Schema Migration
-- Designed for Supabase PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: vx_scans
CREATE TABLE IF NOT EXISTS vx_scans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    media_count INTEGER NOT NULL DEFAULT 0,
    provider TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vx_scans_normalized_url ON vx_scans(normalized_url);
CREATE INDEX IF NOT EXISTS idx_vx_scans_created_at ON vx_scans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vx_scans_expires_at ON vx_scans(expires_at);

-- Table: vx_media
CREATE TABLE IF NOT EXISTS vx_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_id UUID NOT NULL REFERENCES vx_scans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    media_url TEXT NOT NULL,
    thumbnail_url TEXT,
    mime TEXT NOT NULL,
    extension TEXT NOT NULL,
    quality TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    filesize BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vx_media_scan_id ON vx_media(scan_id);
CREATE INDEX IF NOT EXISTS idx_vx_media_created_at ON vx_media(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vx_media_expires_at ON vx_media(expires_at);

-- Table: vx_downloads
CREATE TABLE IF NOT EXISTS vx_downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_id UUID NOT NULL REFERENCES vx_media(id) ON DELETE CASCADE,
    format TEXT NOT NULL DEFAULT 'original',
    status TEXT NOT NULL DEFAULT 'streamed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vx_downloads_media_id ON vx_downloads(media_id);
CREATE INDEX IF NOT EXISTS idx_vx_downloads_created_at ON vx_downloads(created_at DESC);
