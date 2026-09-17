use std::sync::Arc;
use std::time::Instant;

use crate::core::config::AppConfig;
use crate::db::Vault;
use crate::extractors::ProbeBook;
use crate::guard::GuardLimiter;
use crate::http::WireClient;
use crate::vx::Scanner;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub vault: Arc<Vault>,
    pub wire: Arc<WireClient>,
    pub scanner: Arc<Scanner>,
    pub limiter: Arc<GuardLimiter>,
    pub start_time: Instant,
}

impl AppState {
    pub async fn new(config: AppConfig) -> Self {
        let config_arc = Arc::new(config);
        let vault_arc = Arc::new(Vault::init(&config_arc).await);
        let wire_arc = Arc::new(WireClient::new(config_arc.clone()));
        let probes_arc = Arc::new(ProbeBook::new());
        let scanner_arc = Arc::new(Scanner::new(
            wire_arc.clone(),
            probes_arc,
            vault_arc.clone(),
        ));
        let limiter_arc = Arc::new(GuardLimiter::new(
            config_arc.analyze_limit,
            config_arc.download_limit,
        ));

        Self {
            config: config_arc,
            vault: vault_arc,
            wire: wire_arc,
            scanner: scanner_arc,
            limiter: limiter_arc,
            start_time: Instant::now(),
        }
    }
}
