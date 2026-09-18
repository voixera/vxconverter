use serde_json::json;
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

    let config = AppConfig::from_env();
    let state = AppState::new(config).await;

    match state.vault.get_recent_history(20).await {
        Ok(history) => {
            let res = ApiResponse::success(history);
            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&res)?))?)
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
