use std::sync::Arc;
use chrono::Utc;
use url::Url;
use uuid::Uuid;

use crate::core::error::VxError;
use crate::core::types::{MediaCandidate, ScanResult};
use crate::db::Vault;
use crate::extractors::ProbeBook;
use crate::guard::Guard;
use crate::http::WireClient;
use crate::vx::catalog::Catalog;
use crate::vx::jump::Jump;
use crate::vx::sniff::Sniff;

pub struct Scanner {
    wire: Arc<WireClient>,
    probes: Arc<ProbeBook>,
    vault: Arc<Vault>,
}

impl Scanner {
    pub fn new(wire: Arc<WireClient>, probes: Arc<ProbeBook>, vault: Arc<Vault>) -> Self {
        Self {
            wire,
            probes,
            vault,
        }
    }

    pub async fn scan(&self, raw_url: &str) -> Result<ScanResult, VxError> {
        let trimmed = raw_url.trim();
        if trimmed.is_empty() {
            return Err(VxError::InvalidUrl("Empty URL provided".to_string()));
        }

        let normalized_url = Jump::normalize_url(trimmed)
            .map_err(|e| VxError::InvalidUrl(format!("Failed to normalize URL: {e}")))?;

        let parsed_url = Url::parse(&normalized_url)
            .map_err(|e| VxError::InvalidUrl(format!("Failed to parse URL: {e}")))?;

        Guard::validate_url(&parsed_url).await?;

        // 1. Check Vault cache
        if let Some(cached_scan) = self.vault.get_cached_scan(&normalized_url).await? {
            tracing::info!(
                normalized_url = %normalized_url,
                media_count = cached_scan.media_count,
                "Scan cache hit"
            );
            return Ok(cached_scan);
        }

        // 2. Run inspection
        let (raw_candidates, provider) = self.inspect_url(&parsed_url).await?;

        // 3. Deduplicate
        let media = Catalog::consolidate(raw_candidates);
        let media_count = media.len();

        if media_count == 0 {
            return Err(VxError::MediaNotFound);
        }

        let scan_result = ScanResult {
            scan_id: Uuid::new_v4(),
            source_url: trimmed.to_string(),
            normalized_url: normalized_url.clone(),
            media_count,
            media: media.clone(),
            provider: provider.to_string(),
            cached: false,
            created_at: Utc::now(),
        };

        // 4. Save into Vault
        if let Err(e) = self.vault.save_scan(&scan_result).await {
            tracing::warn!("Failed to persist scan in vault: {e}");
        }

        tracing::info!(
            scan_id = %scan_result.scan_id,
            media_count = media_count,
            provider = provider,
            "Scan completed successfully"
        );

        Ok(scan_result)
    }

    async fn inspect_url(&self, url: &Url) -> Result<(Vec<MediaCandidate>, &'static str), VxError> {
        // First check if direct media extension
        if let Some(ext) = Sniff::extract_extension_from_url(url) {
            if Sniff::mime_from_ext(&ext).is_some() {
                return self.probes.run_probes(&self.wire, url, None, None).await;
            }
        }

        let response = self.wire.get_safe(url).await?;
        let headers = response.headers().clone();

        // Check if response Content-Type is direct media
        if let Some(ct) = headers.get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
            let clean_mime = ct.split(';').next().unwrap_or(ct).trim().to_lowercase();
            if Sniff::is_media_mime(&clean_mime) {
                return self
                    .probes
                    .run_probes(&self.wire, url, None, Some(&headers))
                    .await;
            }
        }

        // Read limited text body for HTML parsing
        let body = self.wire.read_limited_text(response).await?;
        self.probes
            .run_probes(&self.wire, url, Some(&body), Some(&headers))
            .await
    }
}
