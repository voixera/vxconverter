use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaCandidate {
    pub id: Uuid,
    pub title: String,
    pub source_url: String,
    pub media_url: String,
    pub thumbnail_url: Option<String>,
    pub mime: String,
    pub extension: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<u32>,
    pub filesize: Option<u64>,
    pub quality: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub scan_id: Uuid,
    pub source_url: String,
    pub normalized_url: String,
    pub media_count: usize,
    pub media: Vec<MediaCandidate>,
    pub provider: String,
    pub cached: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiErrorPayload>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(code: impl Into<String>, message: impl Into<String>) -> ApiResponse<()> {
        ApiResponse {
            ok: false,
            data: None,
            error: Some(ApiErrorPayload {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnalyzeRequest {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadRequest {
    pub media_id: Uuid,
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "original".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthData {
    pub status: String,
    pub version: String,
    pub engine: String,
    pub uptime_secs: u64,
}
