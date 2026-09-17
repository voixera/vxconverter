use serde_json::json;
use vercel_runtime::{run, Body, Error, Request, Response, StatusCode};
use vx_converter::core::types::HealthData;

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(handler).await
}

pub async fn handler(_req: Request) -> Result<Response<Body>, Error> {
    let payload = json!({
        "ok": true,
        "data": HealthData {
            status: "operational".to_string(),
            version: "0.1.0".to_string(),
            engine: "VX Core".to_string(),
            uptime_secs: 0,
        }
    });

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(Body::from(serde_json::to_string(&payload)?))?)
}
