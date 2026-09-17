use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Json;

use crate::core::error::VxError;
use crate::core::state::AppState;
use crate::core::types::{AnalyzeRequest, ApiResponse, ScanResult};

pub async fn analyze_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AnalyzeRequest>,
) -> Result<Json<ApiResponse<ScanResult>>, VxError> {
    let client_key = derive_client_fingerprint(&headers);
    state.limiter.check_analyze(&client_key)?;

    let start = std::time::Instant::now();
    let scan_result = state.scanner.scan(&payload.url).await?;
    let elapsed_ms = start.elapsed().as_millis();

    tracing::info!(
        scan_id = %scan_result.scan_id,
        media_count = scan_result.media_count,
        elapsed_ms = elapsed_ms,
        provider = %scan_result.provider,
        "Analyze request completed"
    );

    Ok(Json(ApiResponse::success(scan_result)))
}

fn derive_client_fingerprint(headers: &HeaderMap) -> String {
    let mut hasher = DefaultHasher::new();

    if let Some(forwarded) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        let first_hop = forwarded.split(',').next().unwrap_or("unknown").trim();
        first_hop.hash(&mut hasher);
    } else if let Some(cf_ip) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        cf_ip.hash(&mut hasher);
    } else {
        "anonymous".hash(&mut hasher);
    }

    if let Some(ua) = headers.get("user-agent").and_then(|v| v.to_str().ok()) {
        ua.hash(&mut hasher);
    }

    format!("client_{:x}", hasher.finish())
}
