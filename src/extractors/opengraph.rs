use async_trait::async_trait;
use scraper::{Html, Selector};
use url::Url;
use uuid::Uuid;

use crate::core::error::VxError;
use crate::core::types::MediaCandidate;
use crate::http::WireClient;
use crate::vx::probe::Probe;
use crate::vx::sniff::Sniff;

pub struct OpenGraphProbe;

#[async_trait]
impl Probe for OpenGraphProbe {
    fn name(&self) -> &'static str {
        "OpenGraphMedia"
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
        let meta_selector = Selector::parse("meta").unwrap();

        let mut og_video: Option<String> = None;
        let mut og_video_type: Option<String> = None;
        let mut og_width: Option<u32> = None;
        let mut og_height: Option<u32> = None;
        let mut og_image: Option<String> = None;
        let mut og_title: Option<String> = None;

        for meta in document.select(&meta_selector) {
            let val = meta.value();
            let prop = val.attr("property").or_else(|| val.attr("name"));
            let content = val.attr("content");

            if let (Some(p), Some(c)) = (prop, content) {
                let p_lower = p.to_lowercase();
                match p_lower.as_str() {
                    "og:video" | "og:video:url" | "og:video:secure_url" => {
                        if og_video.is_none() {
                            og_video = Some(c.to_string());
                        }
                    }
                    "twitter:player:stream" => {
                        if og_video.is_none() {
                            og_video = Some(c.to_string());
                        }
                    }
                    "og:video:type" => og_video_type = Some(c.to_string()),
                    "og:video:width" => og_width = c.parse::<u32>().ok(),
                    "og:video:height" => og_height = c.parse::<u32>().ok(),
                    "og:image" | "twitter:image" => {
                        if og_image.is_none() {
                            og_image = Some(c.to_string());
                        }
                    }
                    "og:title" | "twitter:title" => {
                        if og_title.is_none() {
                            og_title = Some(c.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }

        if let Some(video_raw) = og_video {
            if let Ok(media_url) = url.join(&video_raw) {
                let resolved_thumb = og_image.and_then(|t| url.join(&t).ok().map(|u| u.to_string()));
                let title = og_title.unwrap_or_else(|| "Public Media".to_string());

                let ext_opt = Sniff::extract_extension_from_url(&media_url);
                let mime = og_video_type
                    .or_else(|| ext_opt.as_deref().and_then(Sniff::mime_from_ext).map(|s| s.to_string()))
                    .unwrap_or_else(|| "video/mp4".to_string());

                let clean_mime = mime.split(';').next().unwrap_or(&mime).trim().to_lowercase();
                let extension = Sniff::ext_from_mime(&clean_mime).to_string();
                let quality = Sniff::guess_quality(og_width, og_height, &media_url.to_string());
                let kind = Sniff::media_kind_from_mime(&clean_mime).to_string();

                return Ok(vec![MediaCandidate {
                    id: Uuid::new_v4(),
                    title,
                    source_url: url.to_string(),
                    media_url: media_url.to_string(),
                    thumbnail_url: resolved_thumb,
                    mime: clean_mime,
                    extension,
                    width: og_width,
                    height: og_height,
                    duration: None,
                    filesize: None,
                    quality,
                    kind,
                }]);
            }
        }

        Ok(Vec::new())
    }
}
