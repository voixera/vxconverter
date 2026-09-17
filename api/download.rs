use serde_json::json;
use url::Url;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};
use vx_converter::core::types::{ApiResponse, DownloadRequest};
use vx_converter::vx::nameforge::NameForge;
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
        let err_json = json!(ApiResponse::<()>::err("METHOD_NOT_ALLOWED", "Only POST method is supported"));
        return Ok(Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("Content-Type", "application/json")
            .header("Access-Control-Allow-Origin", "*")
            .body(Body::from(serde_json::to_string(&err_json)?))?);
    }

    let download_req: DownloadRequest = match serde_json::from_slice(req.body()) {
        Ok(parsed) => parsed,
        Err(e) => {
            let err_json = json!(ApiResponse::<()>::err("BAD_REQUEST", format!("Invalid JSON body: {e}")));
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?);
        }
    };

    let config = AppConfig::from_env();
    let state = AppState::new(config).await;

    let media_opt = state.vault.get_media_by_id(&download_req.media_id).await
        .map_err(|e| Error::from(e.to_string()))?;

    let media = match media_opt {
        Some(m) => m,
        None => {
            let err_json = json!(ApiResponse::<()>::err("MEDIA_NOT_FOUND", "Media not found or expired"));
            return Ok(Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(serde_json::to_string(&err_json)?))?);
        }
    };

    let parsed_media_url = match Url::parse(&media.media_url) {
        Ok(u) => u,
        Err(e) => {
            let err_json = json!(ApiResponse::<()>::err("INVALID_URL", format!("Invalid media URL: {e}")));
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_string(&err_json)?))?);
        }
    };

    // Validate SSRF
    if let Err(ssrf_err) = vx_converter::guard::Guard::validate_url(&parsed_media_url).await {
        let err_json = json!(ApiResponse::<()>::err(ssrf_err.error_code(), ssrf_err.to_string()));
        return Ok(Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_string(&err_json)?))?);
    }

    let filename = NameForge::forge(&media.title, &media.quality, &media.extension);
    let disposition = format!("attachment; filename=\"{filename}\"");

    // Open upstream stream
    let upstream_res = state.wire.open_stream(&parsed_media_url).await;
    match upstream_res {
        Ok(res) => {
            let bytes = res.bytes().await.map_err(|e| Error::from(e.to_string()))?;
            let _ = state.vault.record_download(&media.id, &download_req.format, "streamed").await;

            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", &media.mime)
                .header("Content-Disposition", disposition)
                .header("Access-Control-Allow-Origin", "*")
                .header("Accept-Ranges", "bytes")
                .body(Body::from(bytes.to_vec()))?)
        }
        Err(e) => {
            let err_json = json!(ApiResponse::<()>::err(e.error_code(), e.to_string()));
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_string(&err_json)?))?)
        }
    }
}
