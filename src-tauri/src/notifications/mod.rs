use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct NotificationManager {
    enabled: AtomicBool,
    recent_keys: Mutex<HashMap<String, i64>>,
}

impl NotificationManager {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            recent_keys: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Dispatches a deduplicated desktop notification event if enabled
    pub fn send_notification(
        &self,
        app: Option<&AppHandle>,
        dedup_key: &str,
        title: &str,
        body: &str,
        level: &str,
    ) {
        if !self.is_enabled() {
            return;
        }

        let now = chrono::Utc::now().timestamp_millis();
        if let Ok(mut map) = self.recent_keys.lock() {
            // Suppress duplicate notifications within a 2.5s window
            if let Some(&prev_ts) = map.get(dedup_key) {
                if now - prev_ts < 2500 {
                    return;
                }
            }
            map.insert(dedup_key.to_string(), now);
            map.retain(|_, ts| now - *ts < 30_000);
        }

        println!("[Desktop Notification][{}] {} - {}", level, title, body);
        if let Some(handle) = app {
            let _ = handle.emit(
                "desktop-notification",
                serde_json::json!({
                    "title": title,
                    "body": body,
                    "level": level,
                    "timestamp": now
                }),
            );
        }
    }
}
