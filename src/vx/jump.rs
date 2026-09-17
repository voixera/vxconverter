use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use url::Url;

pub struct Jump;

impl Jump {
    pub fn normalize_url(raw: &str) -> Result<String, String> {
        let mut parsed = Url::parse(raw).map_err(|e| e.to_string())?;

        // Clear fragments
        parsed.set_fragment(None);

        // Strip tracking query parameters
        if let Some(query) = parsed.query() {
            let filtered_pairs: Vec<(String, String)> = form_urlencoded::parse(query.as_bytes())
                .filter(|(k, _)| !Self::is_tracking_param(k))
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();

            if filtered_pairs.is_empty() {
                parsed.set_query(None);
            } else {
                let mut serializer = form_urlencoded::Serializer::new(String::new());
                for (k, v) in filtered_pairs {
                    serializer.append_pair(&k, &v);
                }
                parsed.set_query(Some(&serializer.finish()));
            }
        }

        let mut res = parsed.to_string();
        // Remove trailing slash if root path only
        if res.ends_with('/') && parsed.path() == "/" && parsed.query().is_none() {
            res.pop();
        }

        Ok(res)
    }

    fn is_tracking_param(key: &str) -> bool {
        let lower = key.to_lowercase();
        lower.starts_with("utm_")
            || matches!(
                lower.as_str(),
                "fbclid"
                    | "gclid"
                    | "yclid"
                    | "msclkid"
                    | "ref"
                    | "source"
                    | "si"
                    | "igshid"
                    | "mc_eid"
                    | "_hsenc"
                    | "_hsmi"
            )
    }

    pub fn deduplication_key(
        media_url: &str,
        source_url: &str,
        width: Option<u32>,
        height: Option<u32>,
        mime: &str,
    ) -> String {
        if let Ok(normalized) = Self::normalize_url(media_url) {
            normalized
        } else {
            let mut hasher = DefaultHasher::new();
            source_url.hash(&mut hasher);
            width.hash(&mut hasher);
            height.hash(&mut hasher);
            mime.hash(&mut hasher);
            format!("hash:{:x}", hasher.finish())
        }
    }
}
