use url::Url;

pub struct Sniff;

impl Sniff {
    pub fn mime_from_ext(ext: &str) -> Option<&'static str> {
        match ext.to_lowercase().as_str() {
            "mp4" | "m4v" => Some("video/mp4"),
            "webm" => Some("video/webm"),
            "ogg" | "ogv" => Some("video/ogg"),
            "mp3" => Some("audio/mpeg"),
            "m4a" => Some("audio/mp4"),
            "wav" => Some("audio/wav"),
            "m3u8" => Some("application/vnd.apple.mpegurl"),
            "mpd" => Some("application/dash+xml"),
            _ => None,
        }
    }

    pub fn ext_from_mime(mime: &str) -> &'static str {
        let clean = mime.split(';').next().unwrap_or(mime).trim().to_lowercase();
        match clean.as_str() {
            "video/mp4" | "video/quicktime" => "mp4",
            "video/webm" => "webm",
            "video/ogg" => "ogv",
            "audio/mpeg" | "audio/mp3" => "mp3",
            "audio/ogg" => "ogg",
            "audio/mp4" | "audio/x-m4a" => "m4a",
            "audio/wav" | "audio/x-wav" => "wav",
            "application/vnd.apple.mpegurl" | "application/x-mpegurl" => "m3u8",
            "application/dash+xml" => "mpd",
            _ => "mp4",
        }
    }

    pub fn is_media_mime(mime: &str) -> bool {
        let clean = mime.split(';').next().unwrap_or(mime).trim().to_lowercase();
        clean.starts_with("video/")
            || clean.starts_with("audio/")
            || clean == "application/vnd.apple.mpegurl"
            || clean == "application/x-mpegurl"
            || clean == "application/dash+xml"
            || clean == "application/octet-stream"
    }

    pub fn media_kind_from_mime(mime: &str) -> &'static str {
        let clean = mime.split(';').next().unwrap_or(mime).trim().to_lowercase();
        if clean.starts_with("audio/") {
            "audio"
        } else if clean == "application/vnd.apple.mpegurl"
            || clean == "application/x-mpegurl"
            || clean == "application/dash+xml"
        {
            "stream"
        } else {
            "video"
        }
    }

    pub fn guess_quality(width: Option<u32>, height: Option<u32>, text_hint: &str) -> String {
        if let Some(h) = height {
            if h >= 2160 {
                return "4k".to_string();
            } else if h >= 1440 {
                return "1440p".to_string();
            } else if h >= 1080 {
                return "1080p".to_string();
            } else if h >= 720 {
                return "720p".to_string();
            } else if h >= 480 {
                return "480p".to_string();
            } else if h >= 360 {
                return "360p".to_string();
            }
        }

        if let Some(w) = width {
            if w >= 3840 {
                return "4k".to_string();
            } else if w >= 1920 {
                return "1080p".to_string();
            } else if w >= 1280 {
                return "720p".to_string();
            }
        }

        let hint = text_hint.to_lowercase();
        if hint.contains("2160p") || hint.contains("4k") || hint.contains("uhd") {
            "4k".to_string()
        } else if hint.contains("1440p") || hint.contains("2k") {
            "1440p".to_string()
        } else if hint.contains("1080p") || hint.contains("fhd") {
            "1080p".to_string()
        } else if hint.contains("720p") || hint.contains("hd") {
            "720p".to_string()
        } else if hint.contains("480p") || hint.contains("sd") {
            "480p".to_string()
        } else if hint.contains("360p") {
            "360p".to_string()
        } else {
            "standard".to_string()
        }
    }

    pub fn extract_extension_from_url(url: &Url) -> Option<String> {
        let path = url.path();
        if let Some(pos) = path.rfind('.') {
            let ext = &path[pos + 1..];
            if !ext.contains('/') && ext.len() <= 5 {
                return Some(ext.to_lowercase());
            }
        }
        None
    }
}
