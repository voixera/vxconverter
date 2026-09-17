use async_trait::async_trait;
use url::Url;

use crate::core::error::VxError;
use crate::core::types::MediaCandidate;
use crate::http::WireClient;

#[async_trait]
pub trait Probe: Send + Sync {
    fn name(&self) -> &'static str;

    fn matches(&self, url: &Url) -> bool;

    async fn inspect(
        &self,
        wire: &WireClient,
        url: &Url,
        body: Option<&str>,
        headers: Option<&reqwest::header::HeaderMap>,
    ) -> Result<Vec<MediaCandidate>, VxError>;
}
