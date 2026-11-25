// An italic "𝑓" (U+1D453) in the macOS menu bar: a click brings Fusion to the front.

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id("fusion")
        .title("\u{1D453}")
        .tooltip("Fusion")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                front(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn front(app: &AppHandle) {
    if let Some(w) = app.webview_windows().into_values().next() {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
