use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database_url: Option<String>,
    pub supabase_url: Option<String>,
    pub supabase_anon_key: Option<String>,
    pub supabase_service_role_key: Option<String>,

    pub scan_ttl_secs: i64,
    pub analyze_limit: usize,
    pub download_limit: usize,
    pub request_timeout_ms: u64,
    pub max_redirects: usize,
    pub max_response_size: usize,
    pub port: u16,
}

impl AppConfig {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        let database_url = env::var("DATABASE_URL").ok().filter(|s| !s.trim().is_empty());
        let supabase_url = env::var("SUPABASE_URL").ok().filter(|s| !s.trim().is_empty());
        let supabase_anon_key = env::var("SUPABASE_ANON_KEY").ok().filter(|s| !s.trim().is_empty());
        let supabase_service_role_key = env::var("SUPABASE_SERVICE_ROLE_KEY").ok().filter(|s| !s.trim().is_empty());

        let scan_ttl_secs = env::var("VX_SCAN_TTL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(300);

        let analyze_limit = env::var("VX_ANALYZE_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);

        let download_limit = env::var("VX_DOWNLOAD_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20);

        let request_timeout_ms = env::var("VX_REQUEST_TIMEOUT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15_000);

        let max_redirects = env::var("VX_MAX_REDIRECTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);

        let max_response_size = env::var("VX_MAX_RESPONSE_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15 * 1024 * 1024); // 15 MB

        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8080);

        Self {
            database_url,
            supabase_url,
            supabase_anon_key,
            supabase_service_role_key,
            scan_ttl_secs,
            analyze_limit,
            download_limit,
            request_timeout_ms,
            max_redirects,
            max_response_size,
            port,
        }
    }
}
