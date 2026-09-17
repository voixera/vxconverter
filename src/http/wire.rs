use std::sync::Arc;
use std::time::Duration;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use reqwest::{Client, Response, StatusCode};
use url::Url;

use crate::core::config::AppConfig;
use crate::core::error::VxError;
use crate::guard::Guard;

#[derive(Clone)]
pub struct WireClient {
    client: Client,
    config: Arc<AppConfig>,
}

impl WireClient {
    pub fn new(config: Arc<AppConfig>) -> Self {
        let mut default_headers = HeaderMap::new();
        default_headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VXConverter/1.0",
            ),
        );
        default_headers.insert(
            ACCEPT,
            HeaderValue::from_static(
                "text/html,application/xhtml+xml,application/xml;q=0.9,video/*,audio/*,*/*;q=0.8",
            ),
        );

        let timeout = Duration::from_millis(config.request_timeout_ms);
        let max_redirects = config.max_redirects;

        // Custom redirect policy validating each hop against SSRF rules
        let redirect_policy = reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= max_redirects {
                return attempt.error("Too many redirects");
            }

            let next_url = attempt.url();
            let scheme = next_url.scheme().to_lowercase();
            if scheme != "http" && scheme != "https" {
                return attempt.error("Invalid redirect scheme");
            }

            if let Some(host) = next_url.host_str() {
                let host_lower = host.to_lowercase();
                if host_lower == "localhost"
                    || host_lower.ends_with(".localhost")
                    || host_lower.ends_with(".local")
                    || host_lower.ends_with(".internal")
                {
                    return attempt.error("Redirect to blocked host");
                }
                if let Ok(ip) = host.parse::<std::net::IpAddr>() {
                    if Guard::is_ip_blocked(ip) {
                        return attempt.error("Redirect to blocked IP");
                    }
                }
            }

            attempt.follow()
        });

        let client = Client::builder()
            .timeout(timeout)
            .redirect(redirect_policy)
            .default_headers(default_headers)
            .build()
            .expect("Failed to initialize WireClient HTTP client");

        Self { client, config }
    }

    pub async fn get_safe(&self, url: &Url) -> Result<Response, VxError> {
        Guard::validate_url(url).await?;

        let res = self
            .client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    VxError::RequestTimeout
                } else {
                    VxError::UpstreamError(e.to_string())
                }
            })?;

        let status = res.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(VxError::ProtectedMedia(format!(
                "Upstream rejected request with HTTP {}",
                status.as_u16()
            )));
        }

        if !status.is_success() && status != StatusCode::FOUND && status != StatusCode::SEE_OTHER {
            return Err(VxError::UpstreamError(format!(
                "Upstream responded with HTTP {}",
                status.as_u16()
            )));
        }

        Ok(res)
    }

    pub async fn peek_media(&self, url: &Url) -> Result<Option<(String, Option<u64>)>, VxError> {
        Guard::validate_url(url).await?;

        // Attempt HEAD first
        let head_res = self.client.head(url.clone()).send().await;
        if let Ok(res) = head_res {
            if res.status().is_success() {
                let content_type = res
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());

                let content_length = res
                    .headers()
                    .get(reqwest::header::CONTENT_LENGTH)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok());

                if let Some(ct) = content_type {
                    return Ok(Some((ct, content_length)));
                }
            }
        }

        Ok(None)
    }

    pub async fn read_limited_text(&self, res: Response) -> Result<String, VxError> {
        let max_size = self.config.max_response_size;

        if let Some(len) = res.content_length() {
            if len as usize > max_size {
                return Err(VxError::PayloadTooLarge);
            }
        }

        let mut stream = res.bytes_stream();
        let mut collected = Vec::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| VxError::UpstreamError(e.to_string()))?;
            collected.extend_from_slice(&chunk);
            if collected.len() > max_size {
                return Err(VxError::PayloadTooLarge);
            }
        }

        String::from_utf8(collected).map_err(|_| {
            VxError::UpstreamError("Upstream response is not valid UTF-8 text".to_string())
        })
    }

    pub async fn open_stream(&self, url: &Url) -> Result<Response, VxError> {
        Guard::validate_url(url).await?;

        let res = self
            .client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| VxError::UpstreamError(e.to_string()))?;

        if !res.status().is_success() {
            return Err(VxError::UpstreamError(format!(
                "Upstream stream returned HTTP {}",
                res.status().as_u16()
            )));
        }

        Ok(res)
    }
}
