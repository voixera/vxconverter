use async_trait::async_trait;
use regex::Regex;
use url::Url;
use uuid::Uuid;

use crate::core::error::VxError;
use crate::core::types::MediaCandidate;
use crate::http::WireClient;
use crate::vx::probe::Probe;
use crate::vx::sniff::Sniff;

pub struct HlsProbe;

#[async_trait]
impl Probe for HlsProbe {
    fn name(&self) -> &'static str {
        "HlsDashStream"
    }

    fn matches(&self, _url: &Url) -> bool {
        true
    }

    async fn inspect(
        &self,
        _wire: &WireClient,
        url: &Url,
        body: Option<&str>,
        _headers: Option<&reqwest::header::HeaderMap>,
    ) -> Result<Vec<MediaCandidate>, VxError> {
        let html_content = match body {
            Some(b) => b,
            None => return Ok(Vec::new()),
        };

        let mut candidates = Vec::new();

        // Match .m3u8 and .mpd stream URLs within quotes or attributes
        let stream_regex = Regex::new(r#"(https?://[^\s"'<>]+\.(?:m3u8|mpd)(?:\?[^\s"'<>]*)?)"#).unwrap();

        for cap in stream_regex.captures_iter(html_content) {
            if let Some(matched) = cap.get(1) {
                let stream_url_str = matched.as_str();
                if let Ok(parsed_stream_url) = Url::parse(stream_url_str) {
                    let is_m3u8 = parsed_stream_url.path().ends_with(".m3u8");
                    let mime = if is_m3u8 {
                        "application/vnd.apple.mpegurl"
                    } else {
                        "application/dash+xml"
                    };
                    let ext = if is_m3u8 { "m3u8" } else { "mpd" };

                    candidates.push(MediaCandidate {
                        id: Uuid::new_v4(),
                        title: "Adaptive Stream".to_string(),
                        source_url: url.to_string(),
                        media_url: parsed_stream_url.to_string(),
                        thumbnail_url: None,
                        mime: mime.to_string(),
                        extension: ext.to_string(),
                        width: None,
                        height: None,
                        duration: None,
                        filesize: None,
                        quality: Sniff::guess_quality(None, None, stream_url_str),
                        kind: "stream".to_string(),
                    });
                }
            }
        }

        Ok(candidates)
    }
}
