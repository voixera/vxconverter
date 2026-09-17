use serde_json::json;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};
use vx_converter::core::types::{AnalyzeRequest, ApiResponse};
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
            .header("Access-Control-Allow-Methods", "POST, OPTIONS")
            .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            .body(Body::Empty)?);
    }

    if req.method() != "POST" {
        let err_json = json!(ApiResponse::<()>::err(
            "METHOD_NOT_ALLOWED",
            "Only POST method is supported"
        ));
        return Ok(Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("Content-Type", "application/json")
            .header("Access-Control-Allow-Origin", "*")
            .body(Body::from(serde_json::to_string(&err_json)?))?);
    }

    let raw_body = req.body();
    let analyze_req: AnalyzeRequest = match serde_json::from_slice(raw_body) {
        Ok(parsed) => parsed,
        Err(e) => {
            let err_json = json!(ApiResponse::<()>::err(
                "BAD_REQUEST",
                format!("Invalid JSON body: {e}")
            ));
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?);
        }
    };

    let config = AppConfig::from_env();
    let state = AppState::new(config).await;

    match state.scanner.scan(&analyze_req.url).await {
        Ok(scan_result) => {
            let res = ApiResponse::success(scan_result);
            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&res)?))?)
        }
        Err(err) => {
            let status = match err.status_code() {
                axum::http::StatusCode::BAD_REQUEST => StatusCode::BAD_REQUEST,
                axum::http::StatusCode::FORBIDDEN => StatusCode::FORBIDDEN,
                axum::http::StatusCode::NOT_FOUND => StatusCode::NOT_FOUND,
                axum::http::StatusCode::UNAUTHORIZED => StatusCode::UNAUTHORIZED,
                axum::http::StatusCode::GATEWAY_TIMEOUT => StatusCode::GATEWAY_TIMEOUT,
                axum::http::StatusCode::TOO_MANY_REQUESTS => StatusCode::TOO_MANY_REQUESTS,
                axum::http::StatusCode::GONE => StatusCode::GONE,
                axum::http::StatusCode::PAYLOAD_TOO_LARGE => StatusCode::PAYLOAD_TOO_LARGE,
                axum::http::StatusCode::BAD_GATEWAY => StatusCode::BAD_GATEWAY,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            let err_json = json!(ApiResponse::<()>::err(
                err.error_code(),
                err.to_string()
            ));
            Ok(Response::builder()
                .status(status)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?)
        }
    }
}
