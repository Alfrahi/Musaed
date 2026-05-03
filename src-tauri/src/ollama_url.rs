//! Defense-in-depth validation for Ollama base URLs (must mirror frontend `isValidOllamaUrl` policy).

use std::net::{Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

const MAX_BASE_URL_BYTES: usize = 2048;

/// Parses and validates a user-supplied Ollama base URL.
///
/// Allowed: `http`/`https`, no credentials, host is localhost / *.local / loopback / private IPv4 / IPv6 loopback only.
/// Any path, query, or fragment is **stripped** so only scheme + host + port remain,
/// preventing SSRF via path injection (e.g. `http://127.0.0.1:8080/internal-api/delete-user`).
pub fn parse_ollama_base_url(raw: &str) -> Result<Url, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("URL is empty".into());
    }
    if s.len() > MAX_BASE_URL_BYTES {
        return Err("URL is too long".into());
    }

    let trimmed = s.trim_end_matches('/');
    let url = Url::parse(trimmed).map_err(|e| format!("Invalid URL: {e}"))?;

    match url.scheme() {
        "http" | "https" => {}
        other => {
            return Err(format!("Only http and https are allowed (got {other:?})"));
        }
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL must not contain credentials".into());
    }

    // Validate the host before accepting the URL.
    match url.host() {
        Some(Host::Domain(domain)) => {
            if !allowed_domain(domain) {
                return Err(format!(
                    "Host {domain:?} is not an allowed local or private Ollama address"
                ));
            }
        }
        Some(Host::Ipv4(ip)) => {
            if !allowed_ipv4(ip) {
                return Err(format!("IPv4 address {ip} is not allowed for Ollama"));
            }
        }
        Some(Host::Ipv6(ip)) => {
            if !allowed_ipv6(ip) {
                return Err(format!("IPv6 address {ip} is not allowed for Ollama"));
            }
        }
        None => return Err("URL is missing a host".into()),
    }

    // SSRF mitigation: rebuild URL with only scheme + host + port,
    // discarding any path, query, or fragment supplied by the user.
    let port_suffix = match url.port() {
        Some(p) => format!(":{p}"),
        None => String::new(),
    };
    let host_str = url.host_str().ok_or("URL is missing a host")?;
    let clean = format!("{}://{}{}", url.scheme(), host_str, port_suffix);
    Url::parse(&clean).map_err(|e| format!("Failed to rebuild clean URL: {e}"))
}

fn allowed_domain(domain: &str) -> bool {
    let lower = domain.to_ascii_lowercase();
    if matches!(lower.as_str(), "localhost") {
        return true;
    }
    if lower.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = lower.parse::<Ipv4Addr>() {
        return allowed_ipv4(ip);
    }
    false
}

/// Matches TypeScript `isValidOllamaUrl`: private ranges 10/8, 172.16–31/12, 192.168/16, plus loopback.
fn allowed_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_loopback() || ip.is_private()
}

/// Matches current frontend policy: only IPv6 loopback (`::1`), not full ULA.
fn allowed_ipv6(ip: Ipv6Addr) -> bool {
    ip.is_loopback()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_localhost_default_port() {
        let url = parse_ollama_base_url("http://localhost:11434").unwrap();
        assert_eq!(url.as_str(), "http://localhost:11434/");
    }

    #[test]
    fn rejects_public_ip() {
        assert!(parse_ollama_base_url("http://8.8.8.8:11434").is_err());
    }

    #[test]
    fn rejects_credentials() {
        assert!(parse_ollama_base_url("http://user:pass@127.0.0.1:11434").is_err());
    }

    #[test]
    fn allows_private_class_c() {
        let url = parse_ollama_base_url("http://192.168.1.5:11434").unwrap();
        assert_eq!(url.as_str(), "http://192.168.1.5:11434/");
    }

    // --- SSRF path-stripping tests ---

    #[test]
    fn strips_arbitrary_path() {
        let url = parse_ollama_base_url("http://127.0.0.1:8080/internal-api/delete-user").unwrap();
        assert_eq!(url.as_str(), "http://127.0.0.1:8080/");
        assert_eq!(url.path(), "/");
    }

    #[test]
    fn strips_path_and_preserves_port() {
        let url = parse_ollama_base_url("http://localhost:11434/v1/chat/completions").unwrap();
        assert_eq!(url.as_str(), "http://localhost:11434/");
    }

    #[test]
    fn strips_query_and_fragment() {
        let url = parse_ollama_base_url("http://localhost:11434/foo?bar=baz#frag").unwrap();
        assert_eq!(url.as_str(), "http://localhost:11434/");
        assert!(url.query().is_none());
        assert!(url.fragment().is_none());
    }

    #[test]
    fn no_path_remains_clean() {
        let url = parse_ollama_base_url("http://localhost:11434").unwrap();
        assert_eq!(url.as_str(), "http://localhost:11434/");
    }
}
