use axum::extract::State;
use axum::response::Json;

use crate::core::state::AppState;
use crate::core::types::{ApiResponse, HealthData};

pub async fn health_handler(State(state): State<AppState>) -> Json<ApiResponse<HealthData>> {
    let uptime = state.start_time.elapsed().as_secs();
    Json(ApiResponse::success(HealthData {
        status: "operational".to_string(),
        version: "0.1.0".to_string(),
        engine: "VX Core".to_string(),
        uptime_secs: uptime,
    }))
}
