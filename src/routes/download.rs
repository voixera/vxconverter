use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;
use axum::Json;
use url::Url;

use crate::core::error::VxError;
use crate::core::state::AppState;
use crate::core::types::DownloadRequest;
use crate::http::Relay;
use crate::vx::nameforge::NameForge;

pub async fn download_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<DownloadRequest>,
) -> Result<Response, VxError> {
    let client_key = derive_client_fingerprint(&headers);
    state.limiter.check_download(&client_key)?;

    let media = state
        .vault
        .get_media_by_id(&payload.media_id)
        .await?
        .ok_or(VxError::MediaNotFound)?;

    let parsed_media_url = Url::parse(&media.media_url)
        .map_err(|e| VxError::InvalidUrl(format!("Invalid stored media URL: {e}")))?;

    // SSRF Re-validation before streaming
    crate::guard::Guard::validate_url(&parsed_media_url).await?;

    let filename = NameForge::forge(&media.title, &media.quality, &media.extension);

    let upstream = state.wire.open_stream(&parsed_media_url).await?;

    // Record download asynchronously
    let vault_clone = state.vault.clone();
    let media_id = payload.media_id;
    let format = payload.format.clone();
    tokio::spawn(async move {
        let _ = vault_clone
            .record_download(&media_id, &format, "streamed")
            .await;
    });

    tracing::info!(
        media_id = %media.id,
        filename = %filename,
        mime = %media.mime,
        "Download stream initiated"
    );

    Ok(Relay::stream_media(upstream, &filename, &media.mime))
}

fn derive_client_fingerprint(headers: &HeaderMap) -> String {
    let mut hasher = DefaultHasher::new();
    if let Some(forwarded) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        let first_hop = forwarded.split(',').next().unwrap_or("unknown").trim();
        first_hop.hash(&mut hasher);
    } else {
        "anonymous".hash(&mut hasher);
    }
    format!("dl_{:x}", hasher.finish())
}
