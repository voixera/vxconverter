use async_trait::async_trait;
use scraper::{Html, Selector};
use serde_json::Value;
use url::Url;
use uuid::Uuid;

use crate::core::error::VxError;
use crate::core::types::MediaCandidate;
use crate::http::WireClient;
use crate::vx::probe::Probe;
use crate::vx::sniff::Sniff;

pub struct JsonLdProbe;

#[async_trait]
impl Probe for JsonLdProbe {
    fn name(&self) -> &'static str {
        "JsonLdVideo"
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

        let document = Html::parse_document(html_content);
        let script_sel = Selector::parse("script[type='application/ld+json']").unwrap();

        let mut candidates = Vec::new();

        for script in document.select(&script_sel) {
            let text = script.text().collect::<String>();
            if let Ok(json_val) = serde_json::from_str::<Value>(&text) {
                extract_video_objects(&json_val, url, &mut candidates);
            }
        }

        Ok(candidates)
    }
}

fn extract_video_objects(val: &Value, base_url: &Url, candidates: &mut Vec<MediaCandidate>) {
    match val {
        Value::Object(map) => {
            let is_video = map.get("@type").map_or(false, |t| {
                if let Some(s) = t.as_str() {
                    s.eq_ignore_ascii_case("VideoObject")
                } else if let Some(arr) = t.as_array() {
                    arr.iter().any(|v| v.as_str().map_or(false, |s| s.eq_ignore_ascii_case("VideoObject")))
                } else {
                    false
                }
            });

            if is_video {
                if let Some(cand) = parse_video_map(map, base_url) {
                    candidates.push(cand);
                }
            }

            // Also traverse child objects / graph
            if let Some(graph) = map.get("@graph") {
                extract_video_objects(graph, base_url, candidates);
            }
        }
        Value::Array(arr) => {
            for item in arr {
                extract_video_objects(item, base_url, candidates);
            }
        }
        _ => {}
    }
}

fn parse_video_map(map: &serde_json::Map<String, Value>, base_url: &Url) -> Option<MediaCandidate> {
    let content_url = map
        .get("contentUrl")
        .and_then(|v| v.as_str())
        .or_else(|| map.get("embedUrl").and_then(|v| v.as_str()))?;

    let parsed_url = base_url.join(content_url).ok()?;

    let title = map
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| map.get("headline").and_then(|v| v.as_str()))
        .unwrap_or("Public Media")
        .to_string();

    let thumbnail = map
        .get("thumbnailUrl")
        .and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else if let Some(arr) = v.as_array() {
                arr.first().and_then(|x| x.as_str()).map(|s| s.to_string())
            } else {
                None
            }
        })
        .and_then(|t| base_url.join(&t).ok().map(|u| u.to_string()));

    let duration_secs = map
        .get("duration")
        .and_then(|v| v.as_str())
        .and_then(parse_iso8601_duration);

    let width = map.get("width").and_then(|v| v.as_u64()).map(|w| w as u32);
    let height = map.get("height").and_then(|v| v.as_u64()).map(|h| h as u32);

    let ext_opt = Sniff::extract_extension_from_url(&parsed_url);
    let mime = ext_opt
        .as_deref()
        .and_then(Sniff::mime_from_ext)
        .unwrap_or("video/mp4")
        .to_string();

    let extension = Sniff::ext_from_mime(&mime).to_string();
    let quality = Sniff::guess_quality(width, height, &parsed_url.to_string());
    let kind = Sniff::media_kind_from_mime(&mime).to_string();

    Some(MediaCandidate {
        id: Uuid::new_v4(),
        title,
        source_url: base_url.to_string(),
        media_url: parsed_url.to_string(),
        thumbnail_url: thumbnail,
        mime,
        extension,
        width,
        height,
        duration: duration_secs,
        filesize: None,
        quality,
        kind,
    })
}

// Parses ISO 8601 duration: PT1M30S -> 90
fn parse_iso8601_duration(d: &str) -> Option<u32> {
    let s = d.trim().to_uppercase();
    if !s.starts_with('P') {
        return None;
    }

    let mut total_secs = 0u32;
    let mut num_buf = String::new();

    for ch in s.chars() {
        if ch.is_ascii_digit() {
            num_buf.push(ch);
        } else {
            if let Ok(val) = num_buf.parse::<u32>() {
                match ch {
                    'H' => total_secs += val * 3600,
                    'M' => total_secs += val * 60,
                    'S' => total_secs += val,
                    _ => {}
                }
            }
            num_buf.clear();
        }
    }

    if total_secs > 0 {
        Some(total_secs)
    } else {
        None
    }
}
