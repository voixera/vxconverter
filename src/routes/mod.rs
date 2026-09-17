pub mod analyze;
pub mod download;
pub mod health;
pub mod history;
pub mod media;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::core::state::AppState;

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/health", get(health::health_handler))
        .route("/api/analyze", post(analyze::analyze_handler))
        .route("/api/download", post(download::download_handler))
        .route("/api/media/:id", get(media::get_media_handler))
        .route("/api/history", get(history::get_history_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
