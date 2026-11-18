use chrono::Utc;
use std::collections::{HashSet, VecDeque};

pub const DEFAULT_MAX_CLOCK_SKEW_MS: i64 = 120_000; // +-120 seconds
pub const DEFAULT_SESSION_TTL_MS: i64 = 3_600_000; // 1 hour
const MAX_TRACKED_MESSAGE_IDS: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayCheckError {
    SessionMismatch,
    SessionExpired,
    TimestampOutOfWindow,
    DuplicateMessageId,
    NonMonotonicSequence { expected_gt: i64, received: u64 },
}

impl std::fmt::Display for ReplayCheckError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReplayCheckError::SessionMismatch => write!(f, "Session ID mismatch"),
            ReplayCheckError::SessionExpired => write!(f, "Secure session has expired"),
            ReplayCheckError::TimestampOutOfWindow => {
                write!(f, "Message timestamp outside allowed clock-skew window")
            }
            ReplayCheckError::DuplicateMessageId => {
                write!(f, "Duplicate messageId detected (replay attempt)")
            }
            ReplayCheckError::NonMonotonicSequence {
                expected_gt,
                received,
            } => write!(
                f,
                "Non-monotonic sequence number: received {}, expected > {}",
                received, expected_gt
            ),
        }
    }
}

/// Per-session anti-replay guard checking:
/// 1) Session identity & expiration
/// 2) Clock-skew window (+-120s)
/// 3) Duplicate message_id window
/// 4) Strictly monotonic RX sequence number
pub struct ReplayProtector {
    session_id: String,
    expires_at: i64,
    highest_rx_seq: i64,
    seen_ids: HashSet<String>,
    id_order: VecDeque<String>,
}

impl ReplayProtector {
    pub fn new(session_id: String, expires_at: i64) -> Self {
        Self {
            session_id,
            expires_at,
            highest_rx_seq: -1,
            seen_ids: HashSet::new(),
            id_order: VecDeque::new(),
        }
    }

    pub fn validate_incoming(
        &mut self,
        session_id: &str,
        message_id: &str,
        sequence: u64,
        timestamp_ms: i64,
    ) -> Result<(), ReplayCheckError> {
        self.validate_incoming_at(
            session_id,
            message_id,
            sequence,
            timestamp_ms,
            Utc::now().timestamp_millis(),
        )
    }

    pub fn validate_incoming_at(
        &mut self,
        session_id: &str,
        message_id: &str,
        sequence: u64,
        timestamp_ms: i64,
        now_ms: i64,
    ) -> Result<(), ReplayCheckError> {
        if session_id != self.session_id {
            return Err(ReplayCheckError::SessionMismatch);
        }
        if now_ms > self.expires_at {
            return Err(ReplayCheckError::SessionExpired);
        }
        if (now_ms - timestamp_ms).abs() > DEFAULT_MAX_CLOCK_SKEW_MS {
            return Err(ReplayCheckError::TimestampOutOfWindow);
        }
        if self.seen_ids.contains(message_id) {
            return Err(ReplayCheckError::DuplicateMessageId);
        }
        if (sequence as i64) <= self.highest_rx_seq {
            return Err(ReplayCheckError::NonMonotonicSequence {
                expected_gt: self.highest_rx_seq,
                received: sequence,
            });
        }

        self.highest_rx_seq = sequence as i64;
        self.seen_ids.insert(message_id.to_string());
        self.id_order.push_back(message_id.to_string());

        if self.id_order.len() > MAX_TRACKED_MESSAGE_IDS {
            if let Some(oldest) = self.id_order.pop_front() {
                self.seen_ids.remove(&oldest);
            }
        }

        Ok(())
    }
}
