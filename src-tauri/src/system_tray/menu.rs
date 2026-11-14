use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::AppHandle;

pub fn build_tray_menu(app: &AppHandle, active_count: usize) -> tauri::Result<Menu<tauri::Wry>> {
    let status_label = if active_count > 0 {
        format!("Active Transfers: {}", active_count)
    } else {
        "No Active Transfers".to_string()
    };

    let open_item = MenuItem::with_id(app, "tray_open", "Open BeamDrop", true, None::<&str>)?;
    let status_item = MenuItem::with_id(app, "tray_transfers", &status_label, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let pause_all_item = MenuItem::with_id(app, "tray_pause_all", "Pause All Transfers", true, None::<&str>)?;
    let resume_all_item = MenuItem::with_id(app, "tray_resume_all", "Resume All Transfers", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "Quit BeamDrop", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &open_item,
            &status_item,
            &sep1,
            &pause_all_item,
            &resume_all_item,
            &sep2,
            &quit_item,
        ],
    )
}
