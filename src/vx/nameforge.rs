pub struct NameForge;

impl NameForge {
    pub fn forge(title: &str, quality: &str, extension: &str) -> String {
        let clean_ext = extension.trim().trim_start_matches('.').to_lowercase();
        let final_ext = if clean_ext.is_empty() {
            "mp4".to_string()
        } else {
            clean_ext
        };

        let clean_quality = Self::sanitize_token(quality);
        let final_quality = if clean_quality.is_empty() {
            "source".to_string()
        } else {
            clean_quality
        };

        let slug = Self::slugify(title);
        let final_title = if slug.is_empty() {
            "vx-media".to_string()
        } else {
            slug
        };

        format!("{final_title}-{final_quality}.{final_ext}")
    }

    fn slugify(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut prev_dash = false;

        for ch in input.chars() {
            // Disallowed chars: / \ : * ? " < > | and control chars
            if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'..='\x1f') {
                if !prev_dash && !out.is_empty() {
                    out.push('-');
                    prev_dash = true;
                }
                continue;
            }

            if ch.is_alphanumeric() {
                out.extend(ch.to_lowercase());
                prev_dash = false;
            } else if ch == '-' || ch == '_' || ch.is_whitespace() || ch == '.' {
                if !prev_dash && !out.is_empty() {
                    out.push('-');
                    prev_dash = true;
                }
            }
        }

        let trimmed = out.trim_matches('-');
        // Limit slug length to 48 chars
        if trimmed.len() > 48 {
            let mut end = 48;
            while end > 0 && !trimmed.is_char_boundary(end) {
                end -= 1;
            }
            trimmed[..end].trim_matches('-').to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn sanitize_token(token: &str) -> String {
        token
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == 'p' || *c == 'k')
            .collect::<String>()
            .to_lowercase()
    }
}
