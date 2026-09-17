use std::collections::HashMap;
use crate::core::types::MediaCandidate;
use crate::vx::jump::Jump;

pub struct Catalog;

impl Catalog {
    pub fn consolidate(candidates: Vec<MediaCandidate>) -> Vec<MediaCandidate> {
        let mut map: HashMap<String, MediaCandidate> = HashMap::new();

        for candidate in candidates {
            let key = Jump::deduplication_key(
                &candidate.media_url,
                &candidate.source_url,
                candidate.width,
                candidate.height,
                &candidate.mime,
            );

            match map.get_mut(&key) {
                Some(existing) => {
                    // Enrich existing with new fields if missing
                    if existing.thumbnail_url.is_none() && candidate.thumbnail_url.is_some() {
                        existing.thumbnail_url = candidate.thumbnail_url;
                    }
                    if existing.filesize.is_none() && candidate.filesize.is_some() {
                        existing.filesize = candidate.filesize;
                    }
                    if existing.duration.is_none() && candidate.duration.is_some() {
                        existing.duration = candidate.duration;
                    }
                    if existing.width.is_none() && candidate.width.is_some() {
                        existing.width = candidate.width;
                        existing.height = candidate.height;
                    }
                    if existing.title == "Public Media" && candidate.title != "Public Media" {
                        existing.title = candidate.title;
                    }
                }
                None => {
                    map.insert(key, candidate);
                }
            }
        }

        let mut list: Vec<MediaCandidate> = map.into_values().collect();

        // Sort descending by resolution/quality rank
        list.sort_by(|a, b| {
            let rank_a = Self::quality_rank(&a.quality, a.height);
            let rank_b = Self::quality_rank(&b.quality, b.height);
            rank_b.cmp(&rank_a)
        });

        list
    }

    fn quality_rank(quality: &str, height: Option<u32>) -> u32 {
        if let Some(h) = height {
            return h;
        }
        match quality.to_lowercase().as_str() {
            "4k" | "2160p" => 2160,
            "1440p" | "2k" => 1440,
            "1080p" => 1080,
            "720p" => 720,
            "480p" => 480,
            "360p" => 360,
            _ => 100,
        }
    }
}
