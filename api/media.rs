use serde_json::json;
use uuid::Uuid;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};
use vx_converter::core::types::ApiResponse;
use vx_converter::{AppConfig, AppState};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(req: Request) -> Result<Response<Body>, Error> {
    if req.method() == "OPTIONS" {
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
            .header("Access-Control-Allow-Headers", "Content-Type")
            .body(Body::Empty)?);
    }

    // Extract ID from query e.g. /api/media?id=uuid
    let uri = req.uri();
    let query = uri.query().unwrap_or_default();
    let id_opt = query.split('&').find_map(|pair| {
        let mut parts = pair.split('=');
        if parts.next()? == "id" {
            parts.next()
        } else {
            None
        }
    });

    let id_str = match id_opt {
        Some(s) => s,
        None => {
            let err_json = json!(ApiResponse::<()>::err("BAD_REQUEST", "Missing 'id' query parameter"));
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?);
        }
    };

    let media_id = match Uuid::parse_str(id_str) {
        Ok(u) => u,
        Err(_) => {
            let err_json = json!(ApiResponse::<()>::err("INVALID_UUID", "Invalid UUID format for id"));
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?);
        }
    };

    let config = AppConfig::from_env();
    let state = AppState::new(config).await;

    match state.vault.get_media_by_id(&media_id).await {
        Ok(Some(media)) => {
            let res = ApiResponse::success(media);
            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&res)?))?)
        }
        Ok(None) => {
            let err_json = json!(ApiResponse::<()>::err("MEDIA_NOT_FOUND", "Media not found"));
            Ok(Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?)
        }
        Err(e) => {
            let err_json = json!(ApiResponse::<()>::err(e.error_code(), e.to_string()));
            Ok(Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?)
        }
    }
}
