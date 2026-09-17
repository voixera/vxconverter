use async_trait::async_trait;
use scraper::{Html, Selector};
use url::Url;
use uuid::Uuid;

use crate::core::error::VxError;
use crate::core::types::MediaCandidate;
use crate::http::WireClient;
use crate::vx::probe::Probe;
use crate::vx::sniff::Sniff;

pub struct HtmlProbe;

#[async_trait]
impl Probe for HtmlProbe {
    fn name(&self) -> &'static str {
        "Html5Video"
    }

    fn matches(&self, _url: &Url) -> bool {
        true
    }

    async fn inspect(
        &self,
        wire: &WireClient,
        url: &Url,
        body: Option<&str>,
        _headers: Option<&reqwest::header::HeaderMap>,
    ) -> Result<Vec<MediaCandidate>, VxError> {
        let html_content = match body {
            Some(b) => b,
            None => return Ok(Vec::new()),
        };

        // Extract candidates and drop non-Send scraper::Html before awaiting
        let mut candidates = {
            let document = Html::parse_document(html_content);
            let page_title = extract_title(&document);
            let mut list = Vec::new();

            let video_selector = Selector::parse("video").unwrap();
            let source_selector = Selector::parse("source").unwrap();

            for video_elem in document.select(&video_selector) {
                let poster = video_elem
                    .value()
                    .attr("poster")
                    .and_then(|p| url.join(p).ok().map(|u| u.to_string()));

                let width = video_elem
                    .value()
                    .attr("width")
                    .and_then(|w| w.parse::<u32>().ok());
                let height = video_elem
                    .value()
                    .attr("height")
                    .and_then(|h| h.parse::<u32>().ok());

                let direct_src = video_elem
                    .value()
                    .attr("src")
                    .or_else(|| video_elem.value().attr("data-src"))
                    .or_else(|| video_elem.value().attr("data-video"))
                    .or_else(|| video_elem.value().attr("data-url"));

                if let Some(src) = direct_src {
                    if let Ok(full_url) = url.join(src) {
                        if let Some(candidate) = build_candidate(
                            &full_url,
                            url,
                            &page_title,
                            poster.clone(),
                            None,
                            width,
                            height,
                        ) {
                            list.push(candidate);
                        }
                    }
                }

                for src_elem in video_elem.select(&source_selector) {
                    let src = src_elem
                        .value()
                        .attr("src")
                        .or_else(|| src_elem.value().attr("data-src"));
                    let mime_type = src_elem.value().attr("type").map(|s| s.to_string());

                    if let Some(s) = src {
                        if let Ok(full_url) = url.join(s) {
                            if let Some(candidate) = build_candidate(
                                &full_url,
                                url,
                                &page_title,
                                poster.clone(),
                                mime_type,
                                width,
                                height,
                            ) {
                                list.push(candidate);
                            }
                        }
                    }
                }
            }

            for src_elem in document.select(&source_selector) {
                let src = src_elem
                    .value()
                    .attr("src")
                    .or_else(|| src_elem.value().attr("data-src"));
                let mime_type = src_elem.value().attr("type").map(|s| s.to_string());

                if let Some(s) = src {
                    if let Ok(full_url) = url.join(s) {
                        if let Some(candidate) = build_candidate(
                            &full_url,
                            url,
                            &page_title,
                            None,
                            mime_type,
                            None,
                            None,
                        ) {
                            list.push(candidate);
                        }
                    }
                }
            }

            list
        };

        // Peek sizes for discovered candidates
        for cand in candidates.iter_mut().take(3) {
            if cand.filesize.is_none() {
                if let Ok(parsed_media_url) = Url::parse(&cand.media_url) {
                    if let Ok(Some((_, len))) = wire.peek_media(&parsed_media_url).await {
                        cand.filesize = len;
                    }
                }
            }
        }

        Ok(candidates)
    }
}

fn extract_title(document: &Html) -> String {
    let title_sel = Selector::parse("title").unwrap();
    if let Some(elem) = document.select(&title_sel).next() {
        let t = elem.text().collect::<String>().trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }

    let h1_sel = Selector::parse("h1").unwrap();
    if let Some(elem) = document.select(&h1_sel).next() {
        let t = elem.text().collect::<String>().trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }

    "Public Media".to_string()
}

fn build_candidate(
    media_url: &Url,
    source_url: &Url,
    title: &str,
    thumbnail_url: Option<String>,
    explicit_mime: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Option<MediaCandidate> {
    let url_str = media_url.to_string();
    let ext_opt = Sniff::extract_extension_from_url(media_url);

    let mime = explicit_mime
        .or_else(|| ext_opt.as_deref().and_then(Sniff::mime_from_ext).map(|s| s.to_string()))
        .unwrap_or_else(|| "video/mp4".to_string());

    let clean_mime = mime.split(';').next().unwrap_or(&mime).trim().to_lowercase();
    if !Sniff::is_media_mime(&clean_mime) && ext_opt.is_none() {
        return None;
    }

    let extension = Sniff::ext_from_mime(&clean_mime).to_string();
    let quality = Sniff::guess_quality(width, height, &url_str);
    let kind = Sniff::media_kind_from_mime(&clean_mime).to_string();

    Some(MediaCandidate {
        id: Uuid::new_v4(),
        title: title.to_string(),
        source_url: source_url.to_string(),
        media_url: url_str,
        thumbnail_url,
        mime: clean_mime,
        extension,
        width,
        height,
        duration: None,
        filesize: None,
        quality,
        kind,
    })
}
