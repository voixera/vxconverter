use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::TryStreamExt;
use reqwest::Response as ReqwestResponse;

pub struct Relay;

impl Relay {
    pub fn stream_media(
        upstream: ReqwestResponse,
        filename: &str,
        content_type: &str,
    ) -> Response {
        let status = upstream.status();
        let upstream_headers = upstream.headers().clone();

        let stream = upstream
            .bytes_stream()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));

        let body = Body::from_stream(stream);

        let mut headers = HeaderMap::new();

        let clean_content_type = if content_type.is_empty() {
            "application/octet-stream"
        } else {
            content_type
        };

        if let Ok(val) = HeaderValue::from_str(clean_content_type) {
            headers.insert(header::CONTENT_TYPE, val);
        }

        let disposition = format!("attachment; filename=\"{filename}\"");
        if let Ok(val) = HeaderValue::from_str(&disposition) {
            headers.insert(header::CONTENT_DISPOSITION, val);
        }

        if let Some(cl) = upstream_headers.get(reqwest::header::CONTENT_LENGTH) {
            if let Ok(val) = HeaderValue::from_bytes(cl.as_bytes()) {
                headers.insert(header::CONTENT_LENGTH, val);
            }
        }

        if let Some(ar) = upstream_headers.get(reqwest::header::ACCEPT_RANGES) {
            if let Ok(val) = HeaderValue::from_bytes(ar.as_bytes()) {
                headers.insert(header::ACCEPT_RANGES, val);
            }
        } else {
            headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        }

        (
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
            headers,
            body,
        )
            .into_response()
    }
}
