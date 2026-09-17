use url::Url;

use crate::core::error::VxError;
use crate::http::WireClient;

pub struct Peek;

impl Peek {
    pub async fn inspect_remote_media(
        wire: &WireClient,
        url: &Url,
    ) -> Result<(Option<String>, Option<u64>), VxError> {
        if let Ok(Some((mime, len))) = wire.peek_media(url).await {
            Ok((Some(mime), len))
        } else {
            Ok((None, None))
        }
    }
}
