use async_trait::async_trait;
use uuid::Uuid;
use url::Url;

use crate::core::error::VxError;
use crate::core::types::MediaCandidate;
use crate::http::WireClient;
use crate::vx::probe::Probe;
use crate::vx::sniff::Sniff;

pub struct GenericProbe;

#[async_trait]
impl Probe for GenericProbe {
    fn name(&self) -> &'static str {
        "GenericDirect"
    }

    fn matches(&self, url: &Url) -> bool {
        if let Some(ext) = Sniff::extract_extension_from_url(url) {
            Sniff::mime_from_ext(&ext).is_some()
        } else {
            false
        }
    }

    async fn inspect(
        &self,
        wire: &WireClient,
        url: &Url,
        _body: Option<&str>,
        headers: Option<&reqwest::header::HeaderMap>,
    ) -> Result<Vec<MediaCandidate>, VxError> {
        let ext = Sniff::extract_extension_from_url(url).unwrap_or_else(|| "mp4".to_string());
        let default_mime = Sniff::mime_from_ext(&ext).unwrap_or("video/mp4").to_string();

        let mut final_mime = default_mime;
        let mut filesize = None;

        if let Some(hdrs) = headers {
            if let Some(ct) = hdrs.get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
                let clean = ct.split(';').next().unwrap_or(ct).trim().to_string();
                if Sniff::is_media_mime(&clean) {
                    final_mime = clean;
                }
            }
            if let Some(cl) = hdrs.get(reqwest::header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()) {
                filesize = Some(cl);
            }
        }

        // If headers weren't provided or missing filesize, peek remote headers
        if filesize.is_none() {
            if let Ok(Some((peek_mime, peek_len))) = wire.peek_media(url).await {
                if Sniff::is_media_mime(&peek_mime) {
                    final_mime = peek_mime;
                }
                filesize = peek_len;
            }
        }

        let filename = url
            .path_segments()
            .and_then(|mut segs| segs.next_back())
            .unwrap_or("media");

        let title = if let Some(dot) = filename.rfind('.') {
            &filename[..dot]
        } else {
            filename
        };

        let title_clean = if title.is_empty() {
            "Direct Stream Media".to_string()
        } else {
            title.replace(['-', '_'], " ")
        };

        let quality = Sniff::guess_quality(None, None, &url.to_string());
        let kind = Sniff::media_kind_from_mime(&final_mime).to_string();
        let extension = Sniff::ext_from_mime(&final_mime).to_string();

        Ok(vec![MediaCandidate {
            id: Uuid::new_v4(),
            title: title_clean,
            source_url: url.to_string(),
            media_url: url.to_string(),
            thumbnail_url: None,
            mime: final_mime,
            extension,
            width: None,
            height: None,
            duration: None,
            filesize,
            quality,
            kind,
        }])
    }
}
