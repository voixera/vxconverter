use url::Url;

use crate::core::error::VxError;
use crate::core::types::MediaCandidate;
use crate::extractors::generic::GenericProbe;
use crate::extractors::hls::HlsProbe;
use crate::extractors::html5::HtmlProbe;
use crate::extractors::jsonld::JsonLdProbe;
use crate::extractors::opengraph::OpenGraphProbe;
use crate::http::WireClient;
use crate::vx::probe::Probe;

pub struct ProbeBook {
    probes: Vec<Box<dyn Probe>>,
}

impl ProbeBook {
    pub fn new() -> Self {
        let probes: Vec<Box<dyn Probe>> = vec![
            Box::new(GenericProbe),
            Box::new(OpenGraphProbe),
            Box::new(JsonLdProbe),
            Box::new(HtmlProbe),
            Box::new(HlsProbe),
        ];
        Self { probes }
    }

    pub fn register<P: Probe + 'static>(&mut self, probe: P) {
        self.probes.push(Box::new(probe));
    }

    pub async fn run_probes(
        &self,
        wire: &WireClient,
        url: &Url,
        body: Option<&str>,
        headers: Option<&reqwest::header::HeaderMap>,
    ) -> Result<(Vec<MediaCandidate>, &'static str), VxError> {
        let mut all_candidates = Vec::new();
        let mut matched_provider = "generic";

        for probe in &self.probes {
            if probe.matches(url) {
                let found = probe.inspect(wire, url, body, headers).await?;
                if !found.is_empty() {
                    if matched_provider == "generic" {
                        matched_provider = probe.name();
                    }
                    all_candidates.extend(found);
                }
            }
        }

        Ok((all_candidates, matched_provider))
    }
}

impl Default for ProbeBook {
    fn default() -> Self {
        Self::new()
    }
}
