use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VxError {
    #[error("Invalid URL format: {0}")]
    InvalidUrl(String),

    #[error("Destination rejected by SSRF guard: {0}")]
    SsrfBlocked(String),

    #[error("No publicly accessible media was found.")]
    MediaNotFound,

    #[error("This source requires authentication or is access-restricted: {0}")]
    ProtectedMedia(String),

    #[error("Upstream inspect request timed out.")]
    RequestTimeout,

    #[error("Rate limit reached. Please wait before issuing new requests.")]
    RateLimited,

    #[error("Requested media scan has expired or is invalid.")]
    MediaExpired,

    #[error("Upstream response exceeded maximum permissible payload size.")]
    PayloadTooLarge,

    #[error("Upstream request failed: {0}")]
    UpstreamError(String),

    #[error("Database vault error: {0}")]
    VaultError(String),

    #[error("Internal engine error: {0}")]
    Internal(String),
}

impl VxError {
    pub fn error_code(&self) -> &'static str {
        match self {
            VxError::InvalidUrl(_) => "INVALID_URL",
            VxError::SsrfBlocked(_) => "SSRF_BLOCKED",
            VxError::MediaNotFound => "MEDIA_NOT_FOUND",
            VxError::ProtectedMedia(_) => "PROTECTED_MEDIA",
            VxError::RequestTimeout => "REQUEST_TIMEOUT",
            VxError::RateLimited => "RATE_LIMITED",
            VxError::MediaExpired => "MEDIA_EXPIRED",
            VxError::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
            VxError::UpstreamError(_) => "UPSTREAM_ERROR",
            VxError::VaultError(_) => "VAULT_ERROR",
            VxError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    pub fn status_code(&self) -> StatusCode {
        match self {
            VxError::InvalidUrl(_) => StatusCode::BAD_REQUEST,
            VxError::SsrfBlocked(_) => StatusCode::FORBIDDEN,
            VxError::MediaNotFound => StatusCode::NOT_FOUND,
            VxError::ProtectedMedia(_) => StatusCode::UNAUTHORIZED,
            VxError::RequestTimeout => StatusCode::GATEWAY_TIMEOUT,
            VxError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            VxError::MediaExpired => StatusCode::GONE,
            VxError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            VxError::UpstreamError(_) => StatusCode::BAD_GATEWAY,
            VxError::VaultError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            VxError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for VxError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let payload = json!({
            "ok": false,
            "error": {
                "code": self.error_code(),
                "message": self.to_string(),
            }
        });

        (status, Json(payload)).into_response()
    }
}
