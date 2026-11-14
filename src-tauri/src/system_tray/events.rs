use tauri::{AppHandle, Emitter, Manager};

use crate::services::AppState;

pub fn handle_tray_menu_event(app: &AppHandle, id: &str) {
    match id {
        "tray_open" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let state = app.state::<AppState>();
            state.transfer_manager.background.set_minimized(false);
        }
        "tray_transfers" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("navigate-tab", "transfers");
        }
        "tray_pause_all" => {
            let state = app.state::<AppState>();
            state.transfer_manager.pause_all_transfers();
        }
        "tray_resume_all" => {
            let state = app.state::<AppState>();
            state.transfer_manager.resume_all_transfers();
        }
        "tray_quit" => {
            let state = app.state::<AppState>();
            // Safely pause active transfers and flush metadata before exiting
            state.transfer_manager.prepare_safe_shutdown();
            app.exit(0);
        }
        _ => {}
    }
}
