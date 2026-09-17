use axum::extract::{Path, State};
use axum::response::Json;
use uuid::Uuid;

use crate::core::error::VxError;
use crate::core::state::AppState;
use crate::core::types::{ApiResponse, MediaCandidate};

pub async fn get_media_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<MediaCandidate>>, VxError> {
    let media = state
        .vault
        .get_media_by_id(&id)
        .await?
        .ok_or(VxError::MediaNotFound)?;

    Ok(Json(ApiResponse::success(media)))
}
