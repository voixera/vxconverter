use std::sync::Arc;
use std::time::Duration;
use chrono::{Duration as ChronoDuration, Utc};
use dashmap::DashMap;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::core::config::AppConfig;
use crate::core::error::VxError;
use crate::core::types::{MediaCandidate, ScanResult};

#[derive(Clone)]
struct MemoryRecord {
    scan: ScanResult,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Clone)]
pub struct Vault {
    pool: Option<PgPool>,
    ttl_secs: i64,
    mem_scans: Arc<DashMap<String, MemoryRecord>>,
    mem_media: Arc<DashMap<Uuid, MediaCandidate>>,
}

impl Vault {
    pub async fn init(config: &AppConfig) -> Self {
        let pool = if let Some(ref db_url) = config.database_url {
            tracing::info!("Attempting connection to Supabase PostgreSQL...");
            match PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(4))
                .connect(db_url)
                .await
            {
                Ok(p) => {
                    tracing::info!("Connected to Supabase PostgreSQL successfully");
                    Some(p)
                }
                Err(e) => {
                    tracing::warn!(
                        "Could not connect to PostgreSQL ({e}). Operating in resilient in-memory mode."
                    );
                    None
                }
            }
        } else {
            tracing::info!("DATABASE_URL not configured. Operating in resilient in-memory mode.");
            None
        };

        Self {
            pool,
            ttl_secs: config.scan_ttl_secs,
            mem_scans: Arc::new(DashMap::new()),
            mem_media: Arc::new(DashMap::new()),
        }
    }

    pub async fn save_scan(&self, scan: &ScanResult) -> Result<(), VxError> {
        let expires_at = scan.created_at + ChronoDuration::seconds(self.ttl_secs);

        // Always populate in-memory mirror
        self.mem_scans.insert(
            scan.normalized_url.clone(),
            MemoryRecord {
                scan: scan.clone(),
                expires_at,
            },
        );
        for m in &scan.media {
            self.mem_media.insert(m.id, m.clone());
        }

        // Persist to PostgreSQL if connected
        if let Some(ref pool) = self.pool {
            let mut tx = pool.begin().await.map_err(|e| VxError::VaultError(e.to_string()))?;

            let scan_id = scan.scan_id;
            let source_url = &scan.source_url;
            let norm_url = &scan.normalized_url;
            let status = "completed";
            let count = scan.media_count as i32;
            let provider = &scan.provider;
            let created_at = scan.created_at;

            sqlx::query(
                r#"
                INSERT INTO vx_scans (id, source_url, normalized_url, status, media_count, provider, created_at, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING
                "#,
            )
            .bind(scan_id)
            .bind(source_url)
            .bind(norm_url)
            .bind(status)
            .bind(count)
            .bind(provider)
            .bind(created_at)
            .bind(expires_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| VxError::VaultError(e.to_string()))?;

            for m in &scan.media {
                let w = m.width.map(|v| v as i32);
                let h = m.height.map(|v| v as i32);
                let dur = m.duration.map(|v| v as i32);
                let size = m.filesize.map(|v| v as i64);

                sqlx::query(
                    r#"
                    INSERT INTO vx_media (id, scan_id, title, media_url, thumbnail_url, mime, extension, quality, width, height, duration, filesize, created_at, expires_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    ON CONFLICT (id) DO NOTHING
                    "#,
                )
                .bind(m.id)
                .bind(scan_id)
                .bind(&m.title)
                .bind(&m.media_url)
                .bind(&m.thumbnail_url)
                .bind(&m.mime)
                .bind(&m.extension)
                .bind(&m.quality)
                .bind(w)
                .bind(h)
                .bind(dur)
                .bind(size)
                .bind(created_at)
                .bind(expires_at)
                .execute(&mut *tx)
                .await
                .map_err(|e| VxError::VaultError(e.to_string()))?;
            }

            tx.commit().await.map_err(|e| VxError::VaultError(e.to_string()))?;
        }

        Ok(())
    }

    pub async fn get_cached_scan(&self, normalized_url: &str) -> Result<Option<ScanResult>, VxError> {
        let now = Utc::now();

        // 1. Check in-memory first
        if let Some(entry) = self.mem_scans.get(normalized_url) {
            if entry.expires_at > now {
                let mut scan = entry.scan.clone();
                scan.cached = true;
                return Ok(Some(scan));
            }
        }

        // 2. Check Postgres if pool exists
        if let Some(ref pool) = self.pool {
            let scan_row_opt = sqlx::query(
                r#"
                SELECT id, source_url, normalized_url, status, media_count, provider, created_at, expires_at
                FROM vx_scans
                WHERE normalized_url = $1 AND expires_at > $2
                ORDER BY created_at DESC
                LIMIT 1
                "#,
            )
            .bind(normalized_url)
            .bind(now)
            .fetch_optional(pool)
            .await
            .map_err(|e| VxError::VaultError(e.to_string()))?;

            if let Some(row) = scan_row_opt {
                let scan_id: Uuid = row.try_get("id").map_err(|e| VxError::VaultError(e.to_string()))?;
                let source_url: String = row.try_get("source_url").unwrap_or_default();
                let norm_url: String = row.try_get("normalized_url").unwrap_or_default();
                let media_count: i32 = row.try_get("media_count").unwrap_or(0);
                let provider: Option<String> = row.try_get("provider").ok();
                let created_at: chrono::DateTime<Utc> = row.try_get("created_at").unwrap_or_else(|_| Utc::now());

                let media_rows = sqlx::query(
                    r#"
                    SELECT id, title, media_url, thumbnail_url, mime, extension, quality, width, height, duration, filesize
                    FROM vx_media
                    WHERE scan_id = $1
                    "#,
                )
                .bind(scan_id)
                .fetch_all(pool)
                .await
                .map_err(|e| VxError::VaultError(e.to_string()))?;

                let mut media = Vec::new();
                for m_row in media_rows {
                    let id: Uuid = m_row.try_get("id").unwrap_or_else(|_| Uuid::new_v4());
                    let title: String = m_row.try_get("title").unwrap_or_default();
                    let media_url: String = m_row.try_get("media_url").unwrap_or_default();
                    let thumbnail_url: Option<String> = m_row.try_get("thumbnail_url").ok();
                    let mime: String = m_row.try_get("mime").unwrap_or_default();
                    let extension: String = m_row.try_get("extension").unwrap_or_default();
                    let quality: String = m_row.try_get("quality").unwrap_or_default();
                    let width: Option<i32> = m_row.try_get("width").ok();
                    let height: Option<i32> = m_row.try_get("height").ok();
                    let duration: Option<i32> = m_row.try_get("duration").ok();
                    let filesize: Option<i64> = m_row.try_get("filesize").ok();

                    let cand = MediaCandidate {
                        id,
                        title,
                        source_url: source_url.clone(),
                        media_url,
                        thumbnail_url,
                        mime: mime.clone(),
                        extension,
                        width: width.map(|w| w as u32),
                        height: height.map(|h| h as u32),
                        duration: duration.map(|d| d as u32),
                        filesize: filesize.map(|s| s as u64),
                        quality,
                        kind: crate::vx::sniff::Sniff::media_kind_from_mime(&mime).to_string(),
                    };
                    self.mem_media.insert(id, cand.clone());
                    media.push(cand);
                }

                return Ok(Some(ScanResult {
                    scan_id,
                    source_url,
                    normalized_url: norm_url,
                    media_count: media_count as usize,
                    media,
                    provider: provider.unwrap_or_else(|| "generic".to_string()),
                    cached: true,
                    created_at,
                }));
            }
        }

        Ok(None)
    }

    pub async fn get_media_by_id(&self, media_id: &Uuid) -> Result<Option<MediaCandidate>, VxError> {
        // 1. Check in-memory
        if let Some(cand) = self.mem_media.get(media_id) {
            return Ok(Some(cand.clone()));
        }

        // 2. Check Postgres
        if let Some(ref pool) = self.pool {
            let row_opt = sqlx::query(
                r#"
                SELECT m.id, m.title, m.media_url, m.thumbnail_url, m.mime, m.extension, m.quality,
                       m.width, m.height, m.duration, m.filesize, m.expires_at, s.source_url
                FROM vx_media m
                JOIN vx_scans s ON m.scan_id = s.id
                WHERE m.id = $1
                "#,
            )
            .bind(media_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| VxError::VaultError(e.to_string()))?;

            if let Some(m_row) = row_opt {
                let expires_at: chrono::DateTime<Utc> = m_row.try_get("expires_at").unwrap_or_else(|_| Utc::now());
                if expires_at <= Utc::now() {
                    return Err(VxError::MediaExpired);
                }

                let id: Uuid = m_row.try_get("id").unwrap_or(*media_id);
                let title: String = m_row.try_get("title").unwrap_or_default();
                let media_url: String = m_row.try_get("media_url").unwrap_or_default();
                let thumbnail_url: Option<String> = m_row.try_get("thumbnail_url").ok();
                let mime: String = m_row.try_get("mime").unwrap_or_default();
                let extension: String = m_row.try_get("extension").unwrap_or_default();
                let quality: String = m_row.try_get("quality").unwrap_or_default();
                let width: Option<i32> = m_row.try_get("width").ok();
                let height: Option<i32> = m_row.try_get("height").ok();
                let duration: Option<i32> = m_row.try_get("duration").ok();
                let filesize: Option<i64> = m_row.try_get("filesize").ok();
                let source_url: String = m_row.try_get("source_url").unwrap_or_default();

                let cand = MediaCandidate {
                    id,
                    title,
                    source_url,
                    media_url,
                    thumbnail_url,
                    mime: mime.clone(),
                    extension,
                    width: width.map(|w| w as u32),
                    height: height.map(|h| h as u32),
                    duration: duration.map(|d| d as u32),
                    filesize: filesize.map(|s| s as u64),
                    quality,
                    kind: crate::vx::sniff::Sniff::media_kind_from_mime(&mime).to_string(),
                };
                self.mem_media.insert(id, cand.clone());
                return Ok(Some(cand));
            }
        }

        Ok(None)
    }

    pub async fn record_download(&self, media_id: &Uuid, format: &str, status: &str) -> Result<(), VxError> {
        if let Some(ref pool) = self.pool {
            let id = Uuid::new_v4();
            let _ = sqlx::query(
                r#"
                INSERT INTO vx_downloads (id, media_id, format, status, created_at)
                VALUES ($1, $2, $3, $4, NOW())
                "#,
            )
            .bind(id)
            .bind(media_id)
            .bind(format)
            .bind(status)
            .execute(pool)
            .await;
        }
        Ok(())
    }

    pub async fn get_recent_history(&self, limit: usize) -> Result<Vec<ScanResult>, VxError> {
        if let Some(ref pool) = self.pool {
            let rows = sqlx::query(
                r#"
                SELECT id, source_url, normalized_url, status, media_count, provider, created_at, expires_at
                FROM vx_scans
                ORDER BY created_at DESC
                LIMIT $1
                "#,
            )
            .bind(limit as i64)
            .fetch_all(pool)
            .await
            .map_err(|e| VxError::VaultError(e.to_string()))?;

            let mut history = Vec::new();
            for row in rows {
                let scan_id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::new_v4());
                let source_url: String = row.try_get("source_url").unwrap_or_default();
                let normalized_url: String = row.try_get("normalized_url").unwrap_or_default();
                let media_count: i32 = row.try_get("media_count").unwrap_or(0);
                let provider: Option<String> = row.try_get("provider").ok();
                let created_at: chrono::DateTime<Utc> = row.try_get("created_at").unwrap_or_else(|_| Utc::now());

                // Fetch media for this scan
                let m_rows = sqlx::query(
                    r#"
                    SELECT id, title, media_url, thumbnail_url, mime, extension, quality, width, height, duration, filesize
                    FROM vx_media
                    WHERE scan_id = $1
                    "#,
                )
                .bind(scan_id)
                .fetch_all(pool)
                .await
                .unwrap_or_default();

                let mut media = Vec::new();
                for mr in m_rows {
                    let id: Uuid = mr.try_get("id").unwrap_or_else(|_| Uuid::new_v4());
                    let title: String = mr.try_get("title").unwrap_or_default();
                    let media_url: String = mr.try_get("media_url").unwrap_or_default();
                    let thumbnail_url: Option<String> = mr.try_get("thumbnail_url").ok();
                    let mime: String = mr.try_get("mime").unwrap_or_default();
                    let extension: String = mr.try_get("extension").unwrap_or_default();
                    let quality: String = mr.try_get("quality").unwrap_or_default();
                    let width: Option<i32> = mr.try_get("width").ok();
                    let height: Option<i32> = mr.try_get("height").ok();
                    let duration: Option<i32> = mr.try_get("duration").ok();
                    let filesize: Option<i64> = mr.try_get("filesize").ok();

                    media.push(MediaCandidate {
                        id,
                        title,
                        source_url: source_url.clone(),
                        media_url,
                        thumbnail_url,
                        mime: mime.clone(),
                        extension,
                        width: width.map(|w| w as u32),
                        height: height.map(|h| h as u32),
                        duration: duration.map(|d| d as u32),
                        filesize: filesize.map(|s| s as u64),
                        quality,
                        kind: crate::vx::sniff::Sniff::media_kind_from_mime(&mime).to_string(),
                    });
                }

                history.push(ScanResult {
                    scan_id,
                    source_url,
                    normalized_url,
                    media_count: media_count as usize,
                    media,
                    provider: provider.unwrap_or_else(|| "generic".to_string()),
                    cached: false,
                    created_at,
                });
            }

            return Ok(history);
        }

        // Fallback from memory store
        let mut list: Vec<ScanResult> = self
            .mem_scans
            .iter()
            .map(|entry| entry.value().scan.clone())
            .collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list.truncate(limit);
        Ok(list)
    }
}
