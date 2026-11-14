use tauri::AppHandle;

pub struct NotificationManager;

impl NotificationManager {
    /// Dispatches desktop notification if window/app handle is available
    pub fn send_notification(app: Option<&AppHandle>, title: &str, body: &str) {
        // Log to console and emit standard notification event to webview
        println!("[Desktop Notification] {} - {}", title, body);
        if let Some(handle) = app {
            use tauri::Emitter;
            let _ = handle.emit("desktop-notification", serde_json::json!({
                "title": title,
                "body": body,
                "timestamp": chrono::Utc::now().timestamp_millis()
            }));
        }
    }
}
