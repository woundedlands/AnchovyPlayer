//! Tray icon and "close hides to tray". The app stays alive in the tray so that opening a file
//! from Explorer shows an already warm window instead of cold-starting.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, State, Window, WindowEvent, Wry};

const MAIN_WINDOW: &str = "main";
const SHOW_ID: &str = "show";
const QUIT_ID: &str = "quit";

/// Whether the window's close button hides to the tray. The preference lives in settings.json;
/// TypeScript sends it here after loading and on every change.
pub struct CloseToTray(AtomicBool);

/// Menu items kept so their labels can follow the UI language.
pub struct TrayMenu {
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ID, "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("the bundle always has a window icon");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Anchovy Player")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ID => show_main_window(app),
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(TrayMenu { show, quit });
    app.manage(CloseToTray(AtomicBool::new(true)));

    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let hide = window.state::<CloseToTray>().0.load(Ordering::Relaxed);
        if hide {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[tauri::command]
pub async fn set_close_to_tray(state: State<'_, CloseToTray>, enabled: bool) -> Result<(), String> {
    state.0.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn set_tray_labels(menu: State<'_, TrayMenu>, show: String, quit: String) -> Result<(), String> {
    menu.show.set_text(show).map_err(|e| format!("Cannot relabel the tray menu: {e}"))?;
    menu.quit.set_text(quit).map_err(|e| format!("Cannot relabel the tray menu: {e}"))
}
