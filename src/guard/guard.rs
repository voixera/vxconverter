use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use dashmap::DashMap;
use tokio::net::lookup_host;
use url::Url;

use crate::core::error::VxError;

pub struct Guard;

impl Guard {
    pub fn is_ip_blocked(ip: IpAddr) -> bool {
        match ip {
            IpAddr::V4(v4) => Self::is_ipv4_blocked(v4),
            IpAddr::V6(v6) => {
                if let Some(v4) = v6.to_ipv4_mapped() {
                    Self::is_ipv4_blocked(v4)
                } else {
                    Self::is_ipv6_blocked(v6)
                }
            }
        }
    }

    pub fn is_ipv4_blocked(ip: Ipv4Addr) -> bool {
        let octets = ip.octets();

        // 0.0.0.0/8 (Current network)
        if octets[0] == 0 {
            return true;
        }

        // 10.0.0.0/8 (Private network)
        if octets[0] == 10 {
            return true;
        }

        // 127.0.0.0/8 (Loopback)
        if octets[0] == 127 {
            return true;
        }

        // 169.254.0.0/16 (Link-local)
        if octets[0] == 169 && octets[1] == 254 {
            return true;
        }

        // 172.16.0.0/12 (Private network)
        if octets[0] == 172 && (16..=31).contains(&octets[1]) {
            return true;
        }

        // 192.168.0.0/16 (Private network)
        if octets[0] == 192 && octets[1] == 168 {
            return true;
        }

        // 100.64.0.0/10 (Carrier-grade NAT)
        if octets[0] == 100 && (64..=127).contains(&octets[1]) {
            return true;
        }

        // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation)
        if (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
            || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
            || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
        {
            return true;
        }

        // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
        if octets[0] >= 224 {
            return true;
        }

        // 255.255.255.255 (Broadcast)
        if ip.is_broadcast() {
            return true;
        }

        false
    }

    pub fn is_ipv6_blocked(ip: Ipv6Addr) -> bool {
        // ::1 (Loopback)
        if ip.is_loopback() {
            return true;
        }

        // :: (Unspecified)
        if ip.is_unspecified() {
            return true;
        }

        let segments = ip.segments();

        // fe80::/10 (Link-local)
        if (segments[0] & 0xffc0) == 0xfe80 {
            return true;
        }

        // fc00::/7 (Unique local / private address)
        if (segments[0] & 0xfe00) == 0xfc00 {
            return true;
        }

        // ff00::/8 (Multicast)
        if (segments[0] & 0xff00) == 0xff00 {
            return true;
        }

        // 2001:db8::/32 (Documentation)
        if segments[0] == 0x2001 && segments[1] == 0x0db8 {
            return true;
        }

        // Discard prefix 100::/64
        if segments[0] == 0x0100 && segments[1] == 0 {
            return true;
        }

        false
    }

    pub async fn validate_url(url: &Url) -> Result<(), VxError> {
        let scheme = url.scheme().to_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err(VxError::InvalidUrl(format!("Unsupported scheme: '{}'", scheme)));
        }

        if !url.username().is_empty() || url.password().is_some() {
            return Err(VxError::SsrfBlocked("Credentials in URL are forbidden".to_string()));
        }

        let host = url.host_str().ok_or_else(|| {
            VxError::InvalidUrl("Missing host in URL".to_string())
        })?;

        let host_lower = host.to_lowercase();

        // Block localhost aliases and internal domain extensions
        if host_lower == "localhost"
            || host_lower.ends_with(".localhost")
            || host_lower.ends_with(".local")
            || host_lower.ends_with(".internal")
            || host_lower.ends_with(".lan")
            || host_lower.ends_with(".home.arpa")
        {
            return Err(VxError::SsrfBlocked(format!("Blocked hostname: {host}")));
        }

        // Check if host is a literal IP address
        if let Ok(ip) = host.parse::<IpAddr>() {
            if Self::is_ip_blocked(ip) {
                return Err(VxError::SsrfBlocked(format!("Target IP {ip} is restricted")));
            }
            return Ok(());
        }

        // Host is domain name, perform DNS resolution and check all resolved IPs
        let port = url.port_or_known_default().unwrap_or(80);
        let addr_str = format!("{host}:{port}");

        let addresses = lookup_host(&addr_str)
            .await
            .map_err(|e| VxError::UpstreamError(format!("DNS resolution failed for {host}: {e}")))?;

        let mut resolved_any = false;
        for socket_addr in addresses {
            resolved_any = true;
            let ip = socket_addr.ip();
            if Self::is_ip_blocked(ip) {
                return Err(VxError::SsrfBlocked(format!(
                    "Domain {host} resolved to restricted IP: {ip}"
                )));
            }
        }

        if !resolved_any {
            return Err(VxError::UpstreamError(format!("Could not resolve address for {host}")));
        }

        Ok(())
    }
}

// In-memory rate limiter per token (hashed IP/identifier)
#[derive(Debug)]
struct Bucket {
    tokens: usize,
    last_replenished: Instant,
}

pub struct GuardLimiter {
    analyze_limit: usize,
    download_limit: usize,
    analyze_buckets: Arc<DashMap<String, Bucket>>,
    download_buckets: Arc<DashMap<String, Bucket>>,
}

impl GuardLimiter {
    pub fn new(analyze_limit: usize, download_limit: usize) -> Self {
        Self {
            analyze_limit,
            download_limit,
            analyze_buckets: Arc::new(DashMap::new()),
            download_buckets: Arc::new(DashMap::new()),
        }
    }

    pub fn check_analyze(&self, key: &str) -> Result<(), VxError> {
        self.check_bucket(&self.analyze_buckets, key, self.analyze_limit)
    }

    pub fn check_download(&self, key: &str) -> Result<(), VxError> {
        self.check_bucket(&self.download_buckets, key, self.download_limit)
    }

    fn check_bucket(
        &self,
        map: &DashMap<String, Bucket>,
        key: &str,
        capacity: usize,
    ) -> Result<(), VxError> {
        let now = Instant::now();
        let window = Duration::from_secs(60);

        let mut entry = map.entry(key.to_string()).or_insert(Bucket {
            tokens: capacity,
            last_replenished: now,
        });

        if now.duration_since(entry.last_replenished) >= window {
            entry.tokens = capacity;
            entry.last_replenished = now;
        }

        if entry.tokens > 0 {
            entry.tokens -= 1;
            Ok(())
        } else {
            Err(VxError::RateLimited)
        }
    }
}
