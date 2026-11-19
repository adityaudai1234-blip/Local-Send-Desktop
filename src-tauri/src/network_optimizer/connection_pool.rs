use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use chrono::Utc;

use crate::networking::connection::{ConnectionState, PeerConnection};
use crate::performance::metrics::NetworkQualityEvent;
use crate::services::detect_local_ips;

#[derive(Debug, Clone)]
pub struct LinkAssessment {
    pub quality: String,
    pub average_latency_ms: u64,
    pub active_connections: usize,
    pub congestion_detected: bool,
    pub recommended_pacing_delay_ms: u64,
    pub recommended_chunk_cap_bytes: usize,
}

pub struct NetworkOptimizer {
    last_known_ip: Mutex<String>,
    interface_changed_at: Mutex<Option<i64>>,
    congestion_events: AtomicU64,
}

impl NetworkOptimizer {
    pub fn new() -> Self {
        let initial_ip = detect_local_ips()
            .into_iter()
            .next()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        Self {
            last_known_ip: Mutex::new(initial_ip),
            interface_changed_at: Mutex::new(None),
            congestion_events: AtomicU64::new(0),
        }
    }

    /// Evaluates whether an existing authenticated PeerConnection is healthy enough to reuse
    /// without redundant TCP/TLS re-handshakes or renegotiation.
    pub fn should_reuse_connection(
        conn: &PeerConnection,
        target_ip: &str,
        target_port: u16,
    ) -> bool {
        if conn.state != ConnectionState::Connected {
            return false;
        }
        if conn.ip_address != target_ip || conn.port != target_port {
            return false;
        }
        let age_ms = Utc::now().timestamp_millis() - conn.last_heartbeat;
        age_ms <= 20_000
    }

    /// Checks whether the local Wi-Fi / LAN IP address changed since startup or last check.
    pub fn check_interface_change(&self) -> (String, Option<i64>, bool) {
        let current_ip = detect_local_ips()
            .into_iter()
            .next()
            .unwrap_or_else(|| "127.0.0.1".to_string());

        let mut ip_guard = self.last_known_ip.lock().unwrap();
        let mut ts_guard = self.interface_changed_at.lock().unwrap();

        if *ip_guard != current_ip {
            *ip_guard = current_ip.clone();
            let now = Utc::now().timestamp_millis();
            *ts_guard = Some(now);
            return (current_ip, Some(now), true);
        }

        (ip_guard.clone(), *ts_guard, false)
    }

    pub fn record_congestion(&self) {
        self.congestion_events.fetch_add(1, Ordering::Relaxed);
    }

    pub fn congestion_count(&self) -> u64 {
        self.congestion_events.load(Ordering::Relaxed)
    }

    /// Assesses LAN throughput health from live connection latency & retry signals.
    pub fn assess_link_quality(
        &self,
        connections: &[PeerConnection],
        recent_retries: u32,
        current_speed_bps: u64,
    ) -> LinkAssessment {
        let connected: Vec<&PeerConnection> = connections
            .iter()
            .filter(|c| c.state == ConnectionState::Connected)
            .collect();

        let active_connections = connected.len();
        let avg_latency = if connected.is_empty() {
            0
        } else {
            connected.iter().map(|c| c.latency_ms).sum::<u64>() / (connected.len() as u64)
        };

        let congestion_detected = avg_latency > 85
            || recent_retries >= 2
            || (current_speed_bps > 0 && current_speed_bps < 512 * 1024);

        if congestion_detected {
            let quality = if avg_latency > 180 || recent_retries >= 3 {
                "congested"
            } else {
                "degraded"
            };
            return LinkAssessment {
                quality: quality.to_string(),
                average_latency_ms: avg_latency,
                active_connections,
                congestion_detected: true,
                recommended_pacing_delay_ms: 8,
                recommended_chunk_cap_bytes: 256 * 1024,
            };
        }

        let quality = if avg_latency <= 12 {
            "excellent"
        } else {
            "good"
        };

        LinkAssessment {
            quality: quality.to_string(),
            average_latency_ms: avg_latency,
            active_connections,
            congestion_detected: false,
            recommended_pacing_delay_ms: 0,
            recommended_chunk_cap_bytes: 4 * 1024 * 1024,
        }
    }

    pub fn to_quality_event(&self, assessment: &LinkAssessment, interface_ip: String) -> NetworkQualityEvent {
        NetworkQualityEvent {
            quality: assessment.quality.clone(),
            average_latency_ms: assessment.average_latency_ms,
            active_connections: assessment.active_connections,
            congestion_detected: assessment.congestion_detected,
            recommended_chunk_size_bytes: assessment.recommended_chunk_cap_bytes,
            interface_ip,
            timestamp: Utc::now().timestamp_millis(),
        }
    }
}
