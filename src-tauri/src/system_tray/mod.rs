pub mod events;
pub mod menu;

use serde::{Deserialize, Serialize};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::services::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTransferStatus {
    pub active_transfers_count: usize,
    pub paused_transfers_count: usize,
    pub total_transfer_speed_bps: u64,
    pub active_transfer_names: Vec<String>,
    pub is_background_active: bool,
}

pub fn setup_system_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = menu::build_tray_menu(app, 0)?;

    let mut builder = TrayIconBuilder::with_id("beamdrop-tray")
        .menu(&menu)
        .tooltip("BeamDrop - Local File & Folder Share")
        .on_menu_event(|app, event| {
            events::handle_tray_menu_event(app, event.id.as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                let state = app.state::<AppState>();
                state.transfer_manager.background.set_minimized(false);
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
