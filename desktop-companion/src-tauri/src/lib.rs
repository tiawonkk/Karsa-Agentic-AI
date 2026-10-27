//! Karsa desktop shell (Tauri v2).
//!
//! - One transparent, borderless, always-on-top window that covers the screen. It is click-through everywhere except
//!   where the frontend says there is something to click (Dynamic Island, widgets, dock): the frontend reports those
//!   rectangles with `set_interactive_regions`, a small thread follows the cursor and toggles
//!   `set_ignore_cursor_events`. (Once a window ignores the mouse it can no longer tell when the cursor comes back,
//!   so the decision has to be made from outside the page.)
//! - Global shortcuts: Alt+Space (Omni bar) and Alt+K (call Karsa).
//! - System tray: show/hide, sleep mode, quit.
//! - Starts the Python backend (FastAPI on 127.0.0.1:8765) when none is running, and stops it again on exit.

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 8765;
const MAIN_WINDOW: &str = "main";

#[derive(Default)]
struct Backend(Mutex<Option<Child>>);

#[derive(Deserialize, Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Click-through bookkeeping shared between the commands and the cursor thread.
#[derive(Default)]
struct ClickThrough {
    /// Rectangles (CSS pixels, window-relative) that must receive the mouse.
    regions: Mutex<Vec<Rect>>,
    /// True once the frontend has reported regions: from then on the cursor thread decides.
    auto: AtomicBool,
    /// True while a pointer is held down inside the page (dragging a widget must not be cut off).
    drag_lock: AtomicBool,
}

// ------------------------------------------------------------------------------------------------ commands

/// Manual override: ignore (true) or capture (false) the mouse for the whole window.
#[tauri::command]
fn set_ignore_cursor_events(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// The frontend's clickable rectangles. Calling this switches on automatic click-through.
#[tauri::command]
fn set_interactive_regions(state: State<'_, ClickThrough>, regions: Vec<Rect>) {
    if let Ok(mut r) = state.regions.lock() {
        *r = regions;
    }
    state.auto.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn set_drag_lock(state: State<'_, ClickThrough>, lock: bool) {
    state.drag_lock.store(lock, Ordering::SeqCst);
}

#[tauri::command]
fn backend_online() -> bool {
    backend_up()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    shutdown(&app);
}

// ------------------------------------------------------------------------------------------------ backend

fn backend_up() -> bool {
    let addr: SocketAddr = match format!("{BACKEND_HOST}:{BACKEND_PORT}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// The Karsa project folder: `KARSA_ROOT`, else the nearest parent of this executable that holds backend/api/main.py.
fn find_root() -> Option<PathBuf> {
    let marker = ["backend", "api", "main.py"].iter().collect::<PathBuf>();
    if let Ok(r) = std::env::var("KARSA_ROOT") {
        let p = PathBuf::from(r);
        if p.join(&marker).exists() {
            return Some(p);
        }
    }
    let mut dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    for _ in 0..8 {
        if dir.join(&marker).exists() {
            return Some(dir);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

fn python_for(root: &PathBuf) -> PathBuf {
    if let Ok(p) = std::env::var("KARSA_PYTHON") {
        return PathBuf::from(p);
    }
    let venv = if cfg!(windows) {
        root.join(".venv").join("Scripts").join("python.exe")
    } else {
        root.join(".venv").join("bin").join("python")
    };
    if venv.exists() {
        venv
    } else {
        PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
    }
}

/// Starts the backend unless one already answers (a launcher or a developer may have started it).
fn start_backend(state: &Backend) -> Result<(), String> {
    if backend_up() {
        return Ok(());
    }
    let root = find_root().ok_or("Folder proyek Karsa tidak ditemukan. Setel KARSA_ROOT ke folder yang berisi backend/.")?;
    let host = std::env::var("KARSA_HOST").unwrap_or_else(|_| BACKEND_HOST.to_string());
    let mut cmd = Command::new(python_for(&root));
    cmd.args(["-m", "uvicorn", "backend.api.main:app", "--host", &host, "--port", &BACKEND_PORT.to_string()])
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no stray console for the backend
    }
    let child = cmd.spawn().map_err(|e| format!("Backend tidak bisa dijalankan: {e}"))?;
    *state.0.lock().map_err(|_| "state terkunci".to_string())? = Some(child);
    Ok(())
}

fn stop_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn shutdown(app: &AppHandle) {
    stop_backend(app);
    app.exit(0);
}

// ------------------------------------------------------------------------------------------------ window

fn reveal(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn toggle_visibility(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        if w.is_visible().unwrap_or(true) {
            let _ = w.hide();
        } else {
            reveal(app);
        }
    }
}

/// Cover the primary monitor so widgets can be placed anywhere on the screen.
fn cover_primary_monitor(win: &WebviewWindow) {
    if let Ok(Some(m)) = win.primary_monitor() {
        let _ = win.set_size(PhysicalSize::new(m.size().width, m.size().height));
        let _ = win.set_position(PhysicalPosition::new(m.position().x, m.position().y));
    }
}

/// Follows the cursor (~40 Hz) and lets the mouse through everywhere except the reported regions.
fn spawn_cursor_thread(app: AppHandle) {
    thread::spawn(move || {
        let mut last_ignore: Option<bool> = None;
        loop {
            thread::sleep(Duration::from_millis(25));
            let Some(win) = app.get_webview_window(MAIN_WINDOW) else { continue };
            let state = app.state::<ClickThrough>();
            if !state.auto.load(Ordering::SeqCst) || !win.is_visible().unwrap_or(false) {
                continue;
            }
            let want_ignore = if state.drag_lock.load(Ordering::SeqCst) {
                false
            } else {
                let (Ok(cur), Ok(pos), Ok(scale)) = (win.cursor_position(), win.inner_position(), win.scale_factor()) else {
                    continue;
                };
                let x = (cur.x - pos.x as f64) / scale;
                let y = (cur.y - pos.y as f64) / scale;
                let inside = state
                    .regions
                    .lock()
                    .map(|r| r.iter().any(|g| x >= g.x - 2.0 && x <= g.x + g.w + 2.0 && y >= g.y - 2.0 && y <= g.y + g.h + 2.0))
                    .unwrap_or(true);
                !inside
            };
            if last_ignore != Some(want_ignore) && win.set_ignore_cursor_events(want_ignore).is_ok() {
                last_ignore = Some(want_ignore);
            }
        }
    });
}

/// Waits for the backend, then (release builds) loads the UI the backend serves so `/api` calls are same-origin.
fn spawn_ready_thread(app: AppHandle) {
    thread::spawn(move || {
        let started = Instant::now();
        let mut ready = false;
        while started.elapsed() < Duration::from_secs(45) {
            if backend_up() {
                ready = true;
                break;
            }
            thread::sleep(Duration::from_millis(300));
        }
        if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
            if ready && !cfg!(debug_assertions) {
                let _ = win.eval(&format!("window.location.replace('http://{BACKEND_HOST}:{BACKEND_PORT}/')"));
            }
            let _ = win.show();
        }
        if !ready {
            let _ = app.emit("karsa://backend-offline", "Backend Karsa tidak menjawab dalam 45 detik.");
        }
    });
}

// ------------------------------------------------------------------------------------------------ app

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["alt+space", "alt+k"])
                .expect("pintasan global tidak valid")
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    reveal(app);
                    let which = if shortcut.matches(Modifiers::ALT, Code::Space) { "omni" } else { "karsa" };
                    let _ = app.emit("karsa://hotkey", which);
                })
                .build(),
        )
        .manage(Backend::default())
        .manage(ClickThrough::default())
        .invoke_handler(tauri::generate_handler![
            set_ignore_cursor_events,
            set_interactive_regions,
            set_drag_lock,
            backend_online,
            quit_app
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // 1. backend
            if let Err(e) = start_backend(&app.state::<Backend>()) {
                eprintln!("[karsa] {e}");
                let _ = handle.emit("karsa://backend-offline", e);
            }

            // 2. window
            if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
                cover_primary_monitor(&win);
                let _ = win.set_always_on_top(true);
            }

            // 3. tray
            let toggle = MenuItem::with_id(app, "toggle", "Tampilkan / Sembunyikan Karsa", true, None::<&str>)?;
            let sleep = MenuItem::with_id(app, "sleep", "Mode Tidur (Zero-Heat)", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &sleep, &quit])?;
            let mut tray = TrayIconBuilder::with_id("karsa-tray")
                .tooltip("Karsa")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_visibility(app),
                    "sleep" => {
                        reveal(app);
                        let _ = app.emit("karsa://toggle-sleep", ());
                    }
                    "quit" => shutdown(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle_visibility(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // 4. click-through follower and readiness
            spawn_cursor_thread(handle.clone());
            spawn_ready_thread(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Karsa gagal dibuat");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_backend(handle);
        }
    });
}
