use axum::extract::State;
use axum::response::Json;

use crate::core::error::VxError;
use crate::core::state::AppState;
use crate::core::types::{ApiResponse, ScanResult};

pub async fn get_history_handler(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<ScanResult>>>, VxError> {
    let history = state.vault.get_recent_history(20).await?;
    Ok(Json(ApiResponse::success(history)))
}
