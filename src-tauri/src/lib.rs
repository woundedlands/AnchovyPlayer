mod audio;
mod fs;

use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};

use audio::{Engine, PlaybackStatus, TrackInfo, Waveform};
use fs::{DirEntry, FolderWatcher, WalkEntry};

const STATUS_INTERVAL: Duration = Duration::from_millis(16);
const PLAYER_STATUS_EVENT: &str = "player-status";
const FOLDER_CHANGED_EVENT: &str = "folder-changed";
const OPEN_PATH_EVENT: &str = "open-path";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FolderChanged {
    dir: String,
    paths: Vec<String>,
}

/// Runs blocking work (decoding, disk walks) off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Background task failed: {e}"))?
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    blocking(move || fs::list_dir(Path::new(&path))).await
}

#[tauri::command]
async fn list_roots() -> Vec<String> {
    fs::list_roots()
}

#[tauri::command]
async fn walk(root: String, limit: usize) -> Result<Vec<WalkEntry>, String> {
    blocking(move || fs::walk(Path::new(&root), limit)).await
}

#[tauri::command]
async fn watch_dir(app: AppHandle, watcher: State<'_, FolderWatcher>, path: String) -> Result<(), String> {
    let engine = app.state::<Engine>().inner().clone();
    let dir = path.clone();
    watcher.watch(Path::new(&path), move |changed| {
        for path in &changed {
            engine.invalidate(path);
        }
        let paths = changed.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        let _ = app.emit(FOLDER_CHANGED_EVENT, FolderChanged { dir: dir.clone(), paths });
    })
}

#[tauri::command]
async fn play(engine: State<'_, Engine>, path: String) -> Result<TrackInfo, String> {
    let engine = engine.inner().clone();
    blocking(move || engine.play(Path::new(&path))).await
}

#[tauri::command]
async fn pause(engine: State<'_, Engine>) -> Result<(), String> {
    engine.pause();
    Ok(())
}

#[tauri::command]
async fn resume(engine: State<'_, Engine>) -> Result<(), String> {
    engine.resume();
    Ok(())
}

#[tauri::command]
async fn stop(engine: State<'_, Engine>) -> Result<(), String> {
    engine.stop();
    Ok(())
}

#[tauri::command]
async fn seek(engine: State<'_, Engine>, seconds: f64) -> Result<(), String> {
    let engine = engine.inner().clone();
    blocking(move || engine.seek(seconds)).await
}

#[tauri::command]
async fn set_looping(engine: State<'_, Engine>, looping: bool) -> Result<(), String> {
    engine.set_looping(looping);
    Ok(())
}

#[tauri::command]
async fn set_volume(engine: State<'_, Engine>, volume: f32) -> Result<(), String> {
    engine.set_volume(volume);
    Ok(())
}

#[tauri::command]
async fn prefetch(engine: State<'_, Engine>, paths: Vec<String>) -> Result<(), String> {
    engine.prefetch(paths.into_iter().map(PathBuf::from).collect());
    Ok(())
}

#[tauri::command]
async fn waveform(engine: State<'_, Engine>, path: String) -> Result<Waveform, String> {
    let engine = engine.inner().clone();
    let shared = blocking(move || engine.waveform(Path::new(&path))).await?;

    Ok(Waveform {
        channels: shared.channels,
        duration: shared.duration,
        peaks: shared.peaks.clone(),
        bins: shared.bins,
    })
}

const SETTINGS_FILE: &str = "settings.json";

/// Raw contents of settings.json, or None on first run. The schema and validation live in TypeScript.
#[tauri::command]
async fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot read {}: {error}", path.display())),
    }
}

/// Writes through a temporary file and a rename, so a crash mid-write never leaves half a settings file.
#[tauri::command]
async fn save_settings(app: AppHandle, contents: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    let dir = path.parent().expect("settings path has a parent");
    std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, contents).map_err(|e| format!("Cannot write {}: {e}", temporary.display()))?;
    std::fs::rename(&temporary, &path).map_err(|e| format!("Cannot replace {}: {e}", path.display()))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No config folder for settings: {e}"))?;

    Ok(dir.join(SETTINGS_FILE))
}

/// Image shown under the cursor while dragging a file out of the app.
#[tauri::command]
async fn drag_icon_path(app: AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .resolve("drag-icon.png", BaseDirectory::Resource)
        .map_err(|e| format!("Drag icon resource missing: {e}"))?;

    Ok(path.to_string_lossy().into_owned())
}

/// The file or folder the app was launched with ("Open with", drag onto the exe), if any.
#[tauri::command]
async fn launch_path() -> Option<String> {
    let cwd = std::env::current_dir().ok()?;
    path_argument(std::env::args().skip(1), &cwd)
}

fn path_argument(args: impl Iterator<Item = String>, cwd: &Path) -> Option<String> {
    let arg = args.filter(|arg| !arg.starts_with('-')).next()?;

    Some(cwd.join(arg).to_string_lossy().into_owned())
}

fn spawn_status_emitter(app: AppHandle, engine: Engine) {
    thread::Builder::new()
        .name("player-status".into())
        .spawn(move || {
            let mut last: Option<PlaybackStatus> = None;
            loop {
                thread::sleep(STATUS_INTERVAL);
                engine.restart_ended_stream_if_looping();
                let status = engine.status();
                if last != Some(status) {
                    let _ = app.emit(PLAYER_STATUS_EVENT, status);
                    last = Some(status);
                }
            }
        })
        .expect("spawning the player status thread");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launch ("Open with" while running) forwards its path here and exits.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(path) = path_argument(args.into_iter().skip(1), Path::new(&cwd)) {
                let _ = app.emit(OPEN_PATH_EVENT, path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            let engine = Engine::start()?;
            spawn_status_emitter(app.handle().clone(), engine.clone());
            app.manage(engine);
            app.manage(FolderWatcher::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_dir,
            list_roots,
            walk,
            watch_dir,
            play,
            pause,
            resume,
            stop,
            seek,
            set_looping,
            set_volume,
            prefetch,
            waveform,
            launch_path,
            drag_icon_path,
            load_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
