Warning: truncated output (original token count: 46396)
Total output lines: 5025

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Window};
use windows::core::Interface;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::Media::Audio::{
    PlaySoundW, SND_ASYNC, SND_LOOP, SND_MEMORY, SND_SYNC, SND_SYSTEM,
};
use windows::Win32::UI::WindowsAndMessaging::EnumWindows;
use windows::core::PCWSTR;

use crate::services::{
    disable_dock_appbar, enum_windows_proc, register_dock_appbar, sync_overlays,
    unregister_appbar_native,
};
use crate::state::*;
use crate::types::{
    AppInfo, AudioSessionInfo, BrightnessChangeEvent, IntRect, InternetStatus, MicrophoneState,
    SearchFileItem, VolumeChangeEvent, WifiNetworkEntry, WifiStatus,
};
use crate::utils::*;
use std::collections::HashMap;

static TASK_ALARM_STOP: AtomicBool = AtomicBool::new(true);
static TASK_ALARM_THREAD: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();
static TASK_ALARM_WAV: &[u8] = include_bytes!("../resources/task-reminder.wav");

fn play_task_alarm_sound() {
    unsafe {
        let sound_data = PCWSTR(TASK_ALARM_WAV.as_ptr().cast());
        let _ = PlaySoundW(
            sound_data,
            None,
            SND_MEMORY | SND_ASYNC | SND_LOOP | SND_SYSTEM,
        );
    }
}

fn stop_task_alarm_sound() {
    unsafe {
        let _ = PlaySoundW(
            PCWSTR(std::ptr::null()),
            None,
            SND_SYNC,
        );
    }
}

#[tauri::command]
pub fn start_task_alarm() {
    let Some(thread_slot) = TASK_ALARM_THREAD.get_or_init(|| Mutex::new(None)).lock().ok() else {
        return;
    };
    let mut thread_slot = thread_slot;
    if let Some(previous) = thread_slot.take() {
        TASK_ALARM_STOP.store(true, Ordering::SeqCst);
        stop_task_alarm_sound();
        let _ = previous.join();
    }

    TASK_ALARM_STOP.store(false, Ordering::SeqCst);
    *thread_slot = Some(thread::spawn(|| {
        play_task_alarm_sound();
        while !TASK_ALARM_STOP.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(100));
        }
        stop_task_alarm_sound();
    }));
}

#[tauri::command]
pub fn stop_task_alarm() {
    TASK_ALARM_STOP.store(true, Ordering::SeqCst);
    stop_task_alarm_sound();
}

#[tauri::command]
pub async fn set_menu_open(open: bool, rect: Option<IntRect>) {
    MENU_IS_OPEN.store(open, Ordering::Relaxed);
    if let Ok(mut r) = MENU_RECT.lock() {
        *r = rect;
    }
}

#[tauri::command]
pub async fn set_dock_hovered(hovered: bool) {
    DOCK_IS_HOVERED.store(hovered, Ordering::Relaxed);
}

#[tauri::command]
pub async fn set_notch_hovered(app: AppHandle, hovered: bool) {
    NOTCH_IS_HOVERED.store(hovered, Ordering::Relaxed);
    if !hovered {
        crate::services::clear_notch_expiry();
    }
    // Re-evaluate right away. During a native drag the webview never sees the
    // pointer leave, so waiting for the next mouse move can leave the notch
    // (and its edge-hover state) stuck expanded in peek/smart mode.
    crate::services::refresh_main_interaction(&app);
}

#[tauri::command]
pub async fn set_notch_visible(visible: bool) {
    NOTCH_IS_VISIBLE.store(visible, Ordering::Relaxed);
}

#[tauri::command]
pub fn setup_shelf_drop(app: AppHandle) {
    let first = app.clone();
    let _ = app.run_on_main_thread(move || crate::shelf::setup(&first));
    // WebView2 can create or recreate its render child after first paint;
    // re-register once it has settled so the drop target tracks the live window.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
        let late = app.clone();
        let _ = app.run_on_main_thread(move || crate::shelf::setup(&late));
    });
}

/// Small PNG preview for shelf items, as a data URI. `None` for anything that
/// is not a readable image (the frontend falls back to a generic file icon).
#[tauri::command]
pub async fn shelf_thumbnail(path: String) -> Option<String> {
    use base64::Engine;

    let p = std::path::Path::new(&path);
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tif" | "tiff"
    ) {
        return None;
    }
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > 32 * 1024 * 1024 {
        return None;
    }

    // Decode with dimension/allocation caps: a small, highly compressed file
    // can still expand into a huge bitmap.
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(256 * 1024 * 1024);
    let mut reader = image::ImageReader::open(p)
        .ok()?
        .with_guessed_format()
        .ok()?;
    reader.limits(limits);
    let img = reader.decode().ok()?;
    let thumb = img.thumbnail(256, 256);
    let mut png_bytes: Vec<u8> = Vec::new();
    thumb
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

/// Opens a shelf file in its default app. Uses the opener plugin's Rust API
/// directly: its JS `open_path` command additionally requires a path scope,
/// which an empty capability would deny for every file.
#[tauri::command]
pub async fn shelf_open(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

/// Drops shelf entries whose files no longer exist (moved, deleted, drive
/// unplugged). Called once at startup so the shelf does not accumulate dead
/// references across sessions.
#[tauri::command]
pub async fn shelf_prune(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| std::path::Path::new(p).exists())
        .collect()
}

/// Generic document icon used as the native drag preview for shelf items that
/// have no thumbnail. Returned as a PNG data URI.
#[tauri::command]
pub fn shelf_drag_icon() -> Option<String> {
    use base64::Engine;

    let page = image::Rgba([246, 246, 246, 255]);
    let fold = image::Rgba([198, 198, 198, 255]);
    let line = image::Rgba([152, 152, 152, 255]);
    let mut img = image::RgbaImage::from_pixel(64, 64, image::Rgba([0, 0, 0, 0]));

    for y in 6..58u32 {
        for x in 14..50u32 {
            let in_fold = x >= 38 && y <= 18 && (x - 38) + (y - 6) >= 12;
            img.put_pixel(x, y, if in_fold { fold } else { page });
        }
    }
    for (i, y) in [22u32, 30, 38, 46].into_iter().enumerate() {
        let end = if i == 3 { 36 } else { 42 };
        for x in 20..end {
            img.put_pixel(x, y, line);
        }
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    img.write_to(
        &mut std::io::Cursor::new(&mut png_bytes),
        image::ImageFormat::Png,
    )
    .ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
pub async fn update_dock_rect(rect: IntRect) {
    if let Ok(mut r) = DOCK_RECT.lock() {
        *r = Some(rect);
    }
}

#[tauri::command]
pub async fn update_notch_rect(rect: IntRect) {
    if let Ok(mut r) = NOTCH_RECT.lock() {
        *r = Some(rect);
    }
}

#[tauri::command]
pub fn set_window_height(window: Window, height: f64) {
    if let Ok(scale_factor) = window.scale_factor() {
        if let Ok(physical_size) = window.inner_size() {
            let logical_width = physical_size.width as f64 / scale_factor;
            let _ = window.set_size(tauri::LogicalSize::new(logical_width, height));
        }
    }
}

#[tauri::command]
pub fn resize_settings_window(app: AppHandle, width: f64, height: f64) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_size(tauri::LogicalSize::new(width, height));
    }
}

#[tauri::command]
pub fn set_ignore_cursor_events(window: Window, ignore: bool) {
    let _ = window.set_ignore_cursor_events(ignore);
}

#[tauri::command]
pub async fn init_dock(app: AppHandle, mode: String) {
    // Backend guard: bail if dock is disabled in settings.
    // The frontend already checks this, but settings.json may have a stale
    // value if the write didn't complete before restart. Reading here too
    // makes the dock reliably stay hidden regardless of frontend timing.
    if !dock_enabled() {
        disable_dock(&app);
        return;
    }

    if let Some(dock_win) = app.get_webview_window("dock") {
        // 1. Always show first â€” idempotent, required before any positioning
        let _ = dock_win.show();
        if let Ok(hwnd) = dock_win.hwnd() {
            re_assert_topmost(hwnd);
        }

        // 2. Register as appbar (fixed) or manually position (auto-hide)
        if mode == "fixed" {
            // register_dock_appbar calls show() internally too, and handles retries
            register_dock_appbar(dock_win.clone());
        } else {
            // Auto-hide mode: position at bottom of screen.
            // Retry until primary_monitor() is available (can fail on autostart before shell).
            let dock_clone = dock_win.clone();
            tauri::async_runtime::spawn(async move {
                for attempt in 0..20 {
                    if !dock_enabled() {
                        return;
                    }
                    // Wait for monitor and window dimensions to be available.
                    // Never use a hardcoded fallback â€” wrong values produce off-screen placement.
                    // Extract HWND as isize before any await (raw pointer is not Send).
                    let hwnd_val = dock_clone.hwnd().map(|h| h.0 as isize).unwrap_or(0);
                    let ph = dock_clone
                        .outer_size()
                        .map(|s| s.height as i32)
                        .unwrap_or(0);
                    let monitor_info = dock_clone.primary_monitor().ok().flatten().map(|m| {
                        let s = m.size();
                        let p = m.position();
                        (
                            tauri::PhysicalSize::new(s.width, s.height),
                            tauri::PhysicalPosition::new(p.x, p.y),
                        )
                    });

                    if hwnd_val != 0 {
                        if let Some((m_size, m_pos)) = monitor_info {
                            if ph <= 10 {
                                // outer_size() not ready yet â€” retry next tick
                                if attempt < 19 {
                                    tokio::time::sleep(tokio::time::Duration::from_millis(200))
                                        .await;
                                }
                                continue;
                            }
                            let final_y = m_pos.y + m_size.height as i32 - ph;
                            unsafe {
                                use windows::Win32::Foundation::HWND;
                                use windows::Win32::UI::WindowsAndMessaging::{
                                    SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER,
                                };
                                let _ = SetWindowPos(
                                    HWND(hwnd_val as *mut _),
                                    None,
                                    m_pos.x,
                                    final_y,
                                    m_size.width as i32,
                                    ph,
                                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                                );
                            }
                            // Re-assert topmost after repositioning
                            if let Ok(hwnd) = dock_clone.hwnd() {
                                re_assert_topmost(hwnd);
                            }
                            // Ensure visible after positioning
                            if dock_enabled() {
                                let _ = dock_clone.show();
                            }
                            break;
                        }
                    }
                    if attempt < 19 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    }
                }
            });
        }

        // 3. Hide taskbar after showing dock (not before, so user always has something)
        set_taskbar_visibility(false, false);
        NATIVE_TASKBAR_HIDDEN.store(true, Ordering::Relaxed);

        // 4. Reset overlap state so the overlap thread re-syncs cleanly
        CURRENT_DOCK_OVERLAP.store(0, Ordering::Relaxed);
        let _ = app.emit("dock-overlap", false);
        // Sync the adaptive-dock signal so the dock expands immediately if a
        // maximized window is already in the foreground when it's enabled.
        let _ = app.emit(
            "dock-maximized",
            CURRENT_FOREGROUND_MAXIMIZED.load(Ordering::Relaxed),
        );
    }
}

fn disable_dock(app: &AppHandle) {
    // Clear this before showing the native taskbar: the WinEvent hook can run
    // during ShowWindow and would otherwise immediately hide it again.
    NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
    if let Some(dock_win) = app.get_webview_window("dock") {
        disable_dock_appbar(dock_win);
    }
    DOCK_APPBAR_REGISTERED.store(false, Ordering::Relaxed);
    set_taskbar_visibility(true, true);
    crate::services::reconcile_main_appbar(app);
}

#[tauri::command]
pub async fn toggle_dock(app: AppHandle, enable: bool) {
    if enable {
        // Load the saved dock mode; "smart" is the fresh-install default.
        let saved_mode = crate::utils::get_setting_str(&app, "bloom-dock-mode")
            .unwrap_or_else(|| "smart".to_string());
        init_dock(app, saved_mode).await;
    } else {
        disable_dock(&app);
    }
}

#[tauri::command]
pub async fn sync_appbar(app: AppHandle) {
    // Reconcile the notch AppBar against the configured mode so a stale
    // registration cannot survive DPI/power events (issue #109).
    crate::services::reconcile_main_appbar(&app);
    if let Some(dock_win) = app.get_webview_window("dock") {
        // Skip dock re-registration if dock is disabled in settings.
        if dock_enabled() && DOCK_APPBAR_REGISTERED.load(Ordering::Relaxed) {
            register_dock_appbar(dock_win);
        } else {
            if let Ok(hwnd) = dock_win.hwnd() {
                re_assert_topmost(hwnd);
            }
        }
    }
    sync_overlays(&app);
}

#[tauri::command]
pub async fn change_dock_mode(app: AppHandle, mode: String) {
    // A disabled dock keeps the new mode in settings (init_dock applies it on
    // re-enable) but must not be shown or replace the native taskbar now.
    if !dock_enabled() {
        return;
    }
    if let Some(dock_win) = app.get_webview_window("dock") {
        if mode == "fixed" {
            register_dock_appbar(dock_win.clone());
        } else {
            let _ = dock_win.show();
            if let Ok(hwnd) = dock_win.hwnd() {
                let hwnd_val = hwnd.0 as isize;
                tauri::async_runtime::spawn_blocking(move || {
                    unregister_appbar_native(HWND(hwnd_val as *mut _));
                });
                DOCK_APPBAR_REGISTERED.store(false, Ordering::Relaxed);

                // Retry primary_monitor() â€” can fail on autostart before shell initializes
                let dock_clone = dock_win.clone();
                tauri::async_runtime::spawn(async move {
                    for attempt in 0..10 {
                        // Never fall back to a hardcoded pixel height.
                        // Extract HWND as isize before any await (raw pointer is not Send).
                        let hwnd_val = dock_clone.hwnd().map(|h| h.0 as isize).unwrap_or(0);
                        let ph = dock_clone
                            .outer_size()
                            .map(|s| s.height as i32)
                            .unwrap_or(0);
                        let monitor_info = dock_clone.primary_monitor().ok().flatten().map(|m| {
                            let s = m.size();
                            let p = m.position();
                            (
                                tauri::PhysicalSize::new(s.width, s.height),
                                tauri::PhysicalPosition::new(p.x, p.y),
                            )
                        });

                        if hwnd_val != 0 {
                            if let Some((m_size, m_pos)) = monitor_info {
                                if ph <= 10 {
                                    if attempt < 9 {
                                        tokio::time::sleep(tokio::time::Duration::from_millis(300))
                                            .await;
                                    }
                                    continue;
                                }
                                let final_y = m_pos.y + m_size.height as i32 - ph;
                                unsafe {
                                    use windows::Win32::Foundation::HWND;
                                    use windows::Win32::UI::WindowsAndMessaging::{
                                        SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE,
                                        SWP_NOZORDER,
                                    };
                                    let _ = SetWindowPos(
                                        HWND(hwnd_val as *mut _),
                                        None,
                                        m_pos.x,
                                        final_y,
                                        m_size.width as i32,
                                        ph,
                                        SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                                    );
                                }
                                if let Ok(hwnd) = dock_clone.hwnd() {
                                    re_assert_topmost(hwnd);
                                }
                                break;
                            }
                        }
                        if attempt < 9 {
                            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                        }
                    }
                });
            }
        }

        // Ensure always on top and native taskbar stays hidden
        if let Ok(hwnd) = dock_win.hwnd() {
            re_assert_topmost(hwnd);
        }
        set_taskbar_visibility(false, false);
        NATIVE_TASKBAR_HIDDEN.store(true, Ordering::Relaxed);

        // Sync the current overlap state immediately to the frontend
        let current = CURRENT_DOCK_OVERLAP.load(Ordering::Relaxed);
        if current != -1 {
            let _ = app.emit("dock-overlap", current == 1);
        }
        let _ = app.emit(
            "dock-maximized",
            CURRENT_FOREGROUND_MAXIMIZED.load(Ordering::Relaxed),
        );

        // Double sync after a short delay to catch any layout changes
        let dock_clone = dock_win.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if DOCK_APPBAR_REGISTERED.load(Ordering::Relaxed) {
                register_dock_appbar(dock_clone);
            }
        });
    }
}

#[tauri::command]
pub async fn change_notch_mode(app: AppHandle, _mode: String) {
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.show();
        crate::services::apply_main_appbar_mode(&app, false);

        let main_clone = main_win.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            if let Ok(hwnd) = main_clone.hwnd() {
                re_assert_topmost(hwnd);
            }
        });
        // Reposition window to span the full primary monitor so CSS justify-content:center works
        if let Ok(Some(monitor)) = main_win.primary_monitor() {
            let m_pos = monitor.position();
            let m_size = monitor.size();
            let scale = monitor.scale_factor();
            let bloom_scale = crate::utils::get_notch_scale(&app);
            let target_height = (520.0 * bloom_scale * scale) as u32;
            let _ = main_win.set_position(tauri::PhysicalPosition::new(m_pos.x, m_pos.y));
            let _ = main_win.set_size(tauri::PhysicalSize::new(m_size.width, target_height));
        }

        let current = CURRENT_NOTCH_OVERLAP.load(Ordering::Relaxed);
        if current != -1 {
            let _ = app.emit("notch-overlap", current == 1);
        }
    }
}

fn get_uwp_launch_cmd(exe_path: &str) -> Option<String> {
    let path = std::path::Path::new(exe_path);
    let mut is_windows_apps = false;
    let mut package_folder = String::new();

    for component in path.components() {
        if let std::path::Component::Normal(s) = component {
            let s_str = s.to_string_lossy();
            if is_windows_apps {
                package_folder = s_str.to_string();
                break;
            }
            if s_str.eq_ignore_ascii_case("WindowsApps") {
                is_windows_apps = true;
            }
        }
    }

    if !package_folder.is_empty() {
        // package_folder format: PackageName_Version_Architecture__PublisherId
        // We want: PackageName_PublisherId!App
        if let Some(publisher_idx) = package_folder.rfind("__") {
            let publisher_id = &package_folder[publisher_idx + 2..];
            if let Some(first_underscore) = package_folder.find('_') {
                let package_name = &package_folder[..first_underscore];
                return Some(format!(
                    "shell:AppsFolder\\{}_{}!App",
                    package_name, publisher_id
                ));
            }
        }
    }
    None
}

/// Duplicate-event guard. Kept well below the double-click interval so a
/// double-click still toggles twice.
const START_TOGGLE_DEBOUNCE_MS: i64 = 80;
/// Hold time for the Windows key so the shell registers a deliberate tap.
/// A zero-length tap is dropped by the shell and never opens Start.
const START_WIN_KEY_HOLD_MS: u64 = 40;

fn send_key_tap(vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, hold_ms: u64) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, KEYBDINPUT, KEYEVENTF_KEYUP,
    };
    let down = [INPUT {
        r#type: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: Default::default(),
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }];
    let up = [INPUT {
        r#type: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }];
    unsafe {
        SendInput(&down, std::mem::size_of::<INPUT>() as i32);
        if hold_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(hold_ms));
        }
        SendInput(&up, std::mem::size_of::<INPUT>() as i32);
    }
}

/// True while the native Start menu owns the foreground window.
/// Depending on the Windows build it is hosted by StartMenuExperienceHost
/// (older) or SearchHost (Windows 11 24H2+), so match both. The dock is
/// WS_EX_NOACTIVATE, so clicking it never steals focus from an open menu.
fn is_start_menu_open() -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        if pid == 0 {
            return false;
        }
        if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(process);
            if ok.is_ok() {
                let path = String::from_utf16_lossy(&buf[..len as usize]);
                let file = path.rsplit('\\').next().unwrap_or("").to_lowercase();
                return file == "startmenuexperiencehost.exe" || file == "searchhost.exe";
            }
        }
        false
    }
}

/// Toggle the native Start menu. Checks whether the menu currently owns the
/// foreground window instead of blindly tapping Win: rapid Win taps are ignored
/// by the shell while the menu animates, which made a second click replay the
/// open animation. When the menu is open it is dismissed with Escape, which is
/// deterministic. The tiny debounce only coalesces duplicate events; it must
/// stay well below the double-click interval so a double-click still closes.
fn toggle_start_menu() {
    let now = get_now_ms();
    if now - LAST_START_TOGGLE_MS.load(Ordering::Relaxed) < START_TOGGLE_DEBOUNCE_MS {
        return;
    }
    LAST_START_TOGGLE_MS.store(now, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_ESCAPE, VK_LWIN};
        if is_start_menu_open() {
            send_key_tap(VK_ESCAPE, 0);
        } else {
            send_key_tap(VK_LWIN, START_WIN_KEY_HOLD_MS);
        }
    });
}

#[tauri::command]
pub async fn open_app(app: AppHandle, app_name: String) {
    if app_name == "start" {
        toggle_start_menu();
        return;
    }

    if is_bloom_launch_target(&app_name, &app.config().identifier) {
        open_settings_window(app);
        return;
    }

    tauri::async_runtime::spawn_blocking(move || launch_path(&app_name));
}

fn is_bloom_launch_target(target: &str, identifier: &str) -> bool {
    target == "bloom-settings"
        || target.eq_ignore_ascii_case(identifier)
        || std::path::Path::new(target)
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("bloom.exe"))
}

/// Launches another instance of an app instead of focusing an existing window.
/// Running browser PWAs are relaunched through their Start Menu shortcut so the
/// new window belongs to the web app rather than the bare browser.
#[tauri::command]
pub async fn launch_new_instance(app_path: String, app_name: Option<String>) {
    tauri::async_runtime::spawn_blocking(move || {
        if app_path == "start" {
            return;
        }
        let target = pwa_launch_target(&app_path, app_name.as_deref()).unwrap_or(app_path);
        launch_path(&target);
    });
}

/// Finds the Start Menu shortcut of an installed PWA that matches a running
/// browser-host window: same web app title, hosted by the same browser.
fn pwa_launch_target(path: &str, name: Option<&str>) -> Option<String> {
    let name = name?.trim();
    if name.is_empty() || !is_browser_host_process(path) {
        return None;
    }
    let host_exe = std::path::Path::new(path)
        .file_name()?
        .to_str()?
        .to_lowercase();
    let apps = INSTALLED_APPS_CACHE.get()?.lock().ok()?;
    apps.iter()
        .find(|app| is_pwa_shortcut_for(app, name, &host_exe))
        .map(|app| app.path.clone())
}

fn is_pwa_shortcut_for(app: &AppInfo, name: &str, host_exe: &str) -> bool {
    app.name.eq_ignore_ascii_case(name)
        && app
            .executable
            .as_deref()
            .is_some_and(|exe| exe.eq_ignore_ascii_case(host_exe))
}

/// Opens a file path, shortcut, or shell application id through the shell.
fn launch_path(path: &str) {
    unsafe {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let wide_open: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

        // Shortcuts and shell app ids must be launched through the shell itself so
        // that arguments (Chrome/Edge PWAs) and package identities (Store apps) survive.
        let shell_target = if path.to_lowercase().ends_with(".lnk") {
            Some(path.to_string())
        } else if is_aumid_path(path) {
            let id = path.trim().trim_start_matches("shell:AppsFolder\\");
            Some(format!("shell:AppsFolder\\{}", id))
        } else {
            None
        };

        if let Some(target) = shell_target {
            let wide_target: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
            let res = ShellExecuteW(
                None,
                windows::core::PCWSTR(wide_open.as_ptr()),
                windows::core::PCWSTR(wide_target.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            );
            if res.0 as usize <= 32 {
                eprintln!("Failed to open {}: error code {}", target, res.0 as usize);
            }
            return;
        }

        if let Some(uwp_cmd) = crate::commands::get_uwp_launch_cmd(path) {
            let wide_cmd: Vec<u16> = uwp_cmd.encode_utf16().chain(std::iter::once(0)).collect();

            let res = ShellExecuteW(
                None,
                windows::core::PCWSTR(wide_open.as_ptr()),
                windows::core::PCWSTR(wide_cmd.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            );

            if res.0 as usize <= 32 {
                eprintln!(
                    "Failed to open UWP app {}: error code {}",
                    uwp_cmd, res.0 as usize
                );
            }
            return;
        }

        use std::path::Path;
        let mut final_path = path.to_string();

        if !Path::new(&final_path).exists() {
            let file_name = Path::new(&final_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();

            // Handle Discord/Slack style auto-updaters (app-x.x.x folder structure)
            if file_name == "discord.exe"
                || file_name == "slack.exe"
                || file_name == "githubdesktop.exe"
                || file_name == "zentwilight.exe"
            {
                if let Some(parent) = Path::new(&final_path).parent().and_then(|p| p.parent()) {
                    if parent.exists() {
                        if let Ok(entries) = std::fs::read_dir(parent) {
                            let mut app_dirs = Vec::new();
                            for entry in entries.flatten() {
                                let name = entry.file_name().to_string_lossy().to_string();
                                if (name.starts_with("app-") || name.starts_with("current"))
                                    && entry.path().is_dir()
                                {
                                    app_dirs.push(entry.path());
                                }
                            }
                            app_dirs.sort();
                            if let Some(latest) = app_dirs.last() {
                                let exe = latest.join(Path::new(&final_path).file_name().unwrap());
                                if exe.exists() {
                                    final_path = exe.to_string_lossy().to_string();
                                }
                            }
                        }
                    }
                }
            }
        }

        let wide_path: Vec<u16> = final_path
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let wide_open: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

        let res = ShellExecuteW(
            None,
            windows::core::PCWSTR(wide_open.as_ptr()),
            windows::core::PCWSTR(wide_path.as_ptr()),
            None,
            None,
            SW_SHOWNORMAL,
        );

        if res.0 as usize <= 32 {
            eprintln!(
                "Failed to open app {}: error code {}",
                final_path, res.0 as usize
            );
        }
    }
}

#[tauri::command]
pub async fn get_active_windows() -> Vec<AppInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
        // COM is required while enumerating: each window's AppUserModelID is read
        // through the shell property store.
        let com_initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).is_ok() };

        let mut apps: Vec<AppInfo> = Vec::new();
        unsafe {
            let _ = EnumWindows(
                Some(enum_windows_proc),
                LPARAM(&mut apps as *mut Vec<AppInfo> as isize),
            );
        }

        let mut grouped: HashMap<String, AppInfo> = HashMap::new();

        for app in apps {
            let path = app.path.to_lowercase();
            let name = app.name.to_lowercase();

            // For host processes (Edge, Chrome, Brave, ApplicationFrameHost), use path + name
            // so that different PWAs/UWP apps are separate dock items.
            let key = if path.contains("msedge.exe")
                || path.contains("chrome.exe")
                || path.contains("brave.exe")
                || path.contains("applicationframehost.exe")
            {
                format!("{}:{}", path, name)
            } else if let Some(ref exe) = app.executable {
                format!("{}:{}", path, exe.to_lowercase())
            } else {
                path.clone()
            };

            if let Some(existing) = grouped.get_mut(&key) {
                if let Some(ref mut hwnds) = existing.all_hwnds {
                    hwnds.push((app.hwnd.unwrap_or(0), app.name.clone()));
                } else {
                    existing.all_hwnds = Some(vec![
                        (existing.hwnd.unwrap_or(0), existing.name.clone()),
                        (app.hwnd.unwrap_or(0), app.name.clone()),
                    ]);
                }
            } else {
                let mut new_app = app.clone();
                new_app.all_hwnds = Some(vec![(app.hwnd.unwrap_or(0), app.name.clone())]);
                grouped.insert(key, new_app);
            }
        }

        let focus_guard = if let Some(map) = crate::state::FOCUS_TIMESTAMPS.get() {
            map.lock().ok()
        } else {
            None
        };

        let mut result_apps: Vec<AppInfo> = grouped.into_values().collect();

        for app in &mut result_apps {
            if let Some(ref mut hwnds) = app.all_hwnds {
                hwnds.sort_by(|a, b| {
                    let ts_a = focus_guard
                        .as_ref()
                        .and_then(|g| g.get(&a.0))
                        .copied()
                        .unwrap_or(0);
                    let ts_b = focus_guard
                        .as_ref()
                        .and_then(|g| g.get(&b.0))
                        .copied()
                        .unwrap_or(0);
                    ts_b.cmp(&ts_a)
                });
            }
        }

        if com_initialized {
            unsafe {
                CoUninitialize();
            }
        }

        result_apps
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn focus_window(hwnd: isize) {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
            SetForegroundWindow, ShowWindow, SW_MINIMIZE, SW_RESTORE, SW_SHOW,
        };
        let hwnd = HWND(hwnd as *mut _);
        let my_pid = std::process::id();

        if !IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        } else if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        } else {
            // Minimize if: window is foreground, OR same process as foreground (not Bloom), OR recently focused
            let fg = GetForegroundWindow();
            let mut should_minimize = false;

            if !fg.is_invalid() && fg == hwnd {
                should_minimize = true;
            } else if !fg.is_invalid() {
                let mut fg_pid = 0u32;
                let mut target_pid = 0u32;
                GetWindowThreadProcessId(fg, Some(&mut fg_pid));
                GetWindowThreadProcessId(hwnd, Some(&mut target_pid));
                if fg_pid == target_pid && fg_pid != 0 && fg_pid != my_pid {
                    should_minimize = true;
                }
            }

            if !should_minimize {
                let now = crate::utils::get_now_ms();
                should_minimize = if let Some(map) = crate::state::FOCUS_TIMESTAMPS.get() {
                    if let Ok(guard) = map.lock() {
                        guard
                            .get(&(hwnd.0 as *mut () as isize))
                            .map(|ts| now - ts < 2000)
                            .unwrap_or(false)
                    } else {
                        false
                    }
                } else {
                    false
                };
            }

            if should_minimize {
                let _ = ShowWindow(hwnd, SW_MINIMIZE);
            } else {
                let _ = SetForegroundWindow(hwnd);
            }
        }
    })
    .await
    .unwrap_or_default();
}

/// Brings one window of a multi-window dock item forward, like the taskbar's
/// Win+number / Ctrl+click. `hwnds` comes most-recently-focused first: with
/// none of them in front, that one is activated; with one in front, the next
/// window in a stable order is, so repeated clicks visit every window instead
/// of flipping between the two most recent.
#[tauri::command]
pub async fn focus_app_windows(hwnds: Vec<isize>) {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
            SW_RESTORE, SW_SHOW,
        };
        let Some(&most_recent) = hwnds.first() else {
            return;
        };
        let foreground = GetForegroundWindow().0 as isize;
        let mut ring = hwnds.clone();
        ring.sort_unstable();
        let target = match ring.iter().position(|&h| h == foreground) {
            Some(i) => ring[(i + 1) % ring.len()],
            None => most_recent,
        };

        let hwnd = HWND(target as *mut _);
        if !IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    })
    .await
    .unwrap_or_default();
}

fn get_cache_key(path: &str, name: Option<&str>) -> String {
    let path_lc = path.to_lowercase();
    let name_lc = name.map(|n| n.to_lowercase()).unwrap_or_default();
    if path_lc.contains("msedge.exe")
        || path_lc.contains("chrome.exe")
        || path_lc.contains("brave.exe")
        || path_lc.contains("applicationframehost.exe")
    {
        format!("{}:{}", path, name_lc)
    } else {
        path.to_string()
    }
}

fn get_custom_icons_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("custom_icons");
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir)
}

fn sanitize_filename(key: &str) -> String {
    key.replace(
        |c: char| {
            c == ':'
                || c == '\\'
                || c == '/'
                || c == '*'
                || c == '?'
                || c == '"'
                || c == '<'
                || c == '>'
                || c == '|'
        },
        "_",
    )
}

/// Reads a `--flag=value` style argument from a command line, honoring quotes.
fn extract_arg(args: &str, key: &str) -> Option<String> {
    let idx = args.find(key)?;
    let rest = &args[idx + key.len()..];
    let value = if let Some(stripped) = rest.strip_prefix('"') {
        stripped.split('"').next().unwrap_or("")
    } else {
        rest.split_whitespace().next().unwrap_or("")
    };
    let value = value.trim().trim_matches('"');
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// True for shell application ids (`PackageFamily!App`, `Company.Product`, ...)
/// that are not real file system paths.
pub fn is_aumid_path(path: &str) -> bool {
    let p = path.trim().trim_matches('"');
    if p.is_empty() || p.len() < 3 {
        return false;
    }
    if p.to_lowercase().starts_with("shell:appsfolder\\") {
        return true;
    }
    if p.contains('\\') || p.contains('/') || p.contains(':') {
        return false;
    }
    if p.to_lowercase().ends_with(".exe") {
        return false;
    }
    if std::path::Path::new(p).exists() {
        return false;
    }
    true
}

fn is_browser_host_process(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("msedge.exe")
        || p.contains("chrome.exe")
        || p.contains("brave.exe")
        || p.contains("vivaldi.exe")
        || p.contains("firefox.exe")
}

/// Resolves the icon of a shell application id (Store/UWP/packaged PWA) through
/// `shell:AppsFolder`. `SHGetFileInfoW` cannot handle these; `IShellItemImageFactory` can.
fn icon_from_aumid(aumid: &str) -> Option<String> {
    unsafe {
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::UI::Shell::{
            IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_BIGGERSIZEOK,
            SIIGBF_ICONONLY,
        };

        let id = aumid.trim().trim_start_matches("shell:AppsFolder\\");
        if id.is_empty() {
            return None;
        }

        let parsing_name = format!("shell:AppsFolder\\{}", id);
        let wide: Vec<u16> = parsing_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(windows::core::PCWSTR(wide.as_ptr()), None).ok()?;

        let size = SIZE { cx: 256, cy: 256 };
        let hbitmap = factory
            .GetImage(size, SIIGBF(SIIGBF_ICONONLY.0 | SIIGBF_BIGGERSIZEOK.0))
            .or_else(|_| factory.GetImage(size, SIIGBF_BIGGERSIZEOK))
            .ok()?;
        if hbitmap.0.is_null() {
            return None;
        }

        let result = crate::utils::hbitmap_to_base64(hbitmap);
        let _ = windows::Win32::Graphics::Gdi::DeleteObject(hbitmap.into());
        result
    }
}

/// Derives the package family name (`Name_PublisherId`) from a WindowsApps exe path.
/// Package folders look like `Name_Version_Architecture__PublisherId`.
fn package_family_from_windows_apps_path(path: &str) -> Option<String> {
    let lower = path.to_lowercase();
    let idx = lower.find("\\windowsapps\\")?;
    let rest = &path[idx + "\\windowsapps\\".len()..];
    let folder = rest.split(['\\', '/']).next()?;
    let (before_publisher, publisher) = folder.rsplit_once("__")?;
    let name = before_publisher.split('_').next()?;
    if name.is_empty() || publisher.is_empty() {
        return None;
    }
    Some(format!("{}_{}", name, publisher))
}

/// Finds the exact AppUserModelID of an installed app from its package family name
/// by enumerating `shell:AppsFolder` (the `!App` suffix is not guaranteed).
fn find_aumid_by_family(family: &str) -> Option<String> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{
        FOLDERID_AppsFolder, IEnumIDList, ILCombine, ILFree, IShellFolder, SHGetDesktopFolder,
        SHGetKnownFolderIDList, SHGetNameFromIDList, SHCONTF_FOLDERS, SHCONTF_NONFOLDERS,
        SIGDN_DESKTOPABSOLUTEPARSING,
    };

    unsafe {
        let pidl_apps = SHGetKnownFolderIDList(&FOLDERID_AppsFolder, 0, None).ok()?;
        let result = (|| -> Option<String> {
            let desktop = SHGetDesktopFolder().ok()?;
            let apps_folder: IShellFolder = desktop.BindToObject(pidl_apps, None).ok()?;
            let mut enum_id: Option<IEnumIDList> = None;
            if apps_folder
                .EnumObjects(
                    HWND(std::ptr::null_mut()),
                    (SHCONTF_FOLDERS.0 | SHCONTF_NONFOLDERS.0) as u32,
                    &mut enum_id,
                )
                .is_err()
            {
                return None;
            }
            let enum_id = enum_id?;

            let prefix = format!("{}!", family);
            let mut pidl_buf: [*mut windows::Win32::UI::Shell::Common::ITEMIDLIST; 1] =
                [std::ptr::null_mut()];
            let mut fetched = 0;
            while enum_id.Next(&mut pidl_buf, Some(&mut fetched)).is_ok() && fetched > 0 {
                let pidl_item = pidl_buf[0];
                pidl_buf[0] = std::ptr::null_mut();
                if pidl_item.is_null() {
                    continue;
                }

                let absolute_pidl =
                    ILCombine(Some(pidl_apps as *const _), Some(pidl_item as *const _));
                if absolute_pidl.is_null() {
                    CoTaskMemFree(Some(pidl_item as *const _));
                    continue;
                }

                let mut found = None;
                if let Ok(p_ptr) = SHGetNameFromIDList(absolute_pidl, SIGDN_DESKTOPABSOLUTEPARSING)
                {
                    let s = String::from_utf16_lossy(windows::core::PCWSTR(p_ptr.0).as_wide());
                    CoTaskMemFree(Some(p_ptr.0 as *const _));
                    if s.starts_with(&prefix) {
                        found = Some(s);
                    }
                }
                ILFree(Some(absolute_pidl as *const _));
                CoTaskMemFree(Some(pidl_item as *const _));
                if found.is_some() {
                    return found;
                }
            }
            None
        })();
        CoTaskMemFree(Some(pidl_apps as *const _));
        result
    }
}

/// Icon for executables that live inside an MSIX package (`\WindowsApps\...`).
/// Those exes carry no app icon; the package manifest logo is the real icon.
fn packaged_exe_icon(path: &str) -> Option<String> {
    let family = package_family_from_windows_apps_path(path)?;
    let aumid = find_aumid_by_family(&family)?;
    icon_from_aumid(&aumid)
}

/// Command line of a process, via WMI. Used to identify PWAs hosted inside browser processes.
fn process_command_line(pid: u32) -> Option<String> {
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Win32Process {
        command_line: Option<String>,
    }

    let com = wmi::COMLibrary::new().ok()?;
    let connection = wmi::WMIConnection::new(com).ok()?;
    let results: Vec<Win32Process> = connection
        .raw_query(format!(
            "SELECT CommandLine FROM Win32_Process WHERE ProcessId = {}",
            pid
        ))
        .ok()?;
    results.into_iter().next().and_then(|p| p.command_line)
}

fn pwa_icon_from_command_line(process_path: &str, command_line: &str) -> Option<String> {
    // Store PWAs launched by Edge carry their package identity inline.
    if let Some(aumid) = extract_arg(command_line, "--ip-aumid=") {
        if let Some(icon) = icon_from_aumid(&aumid) {
            return Some(icon);
        }
    }
    // Chrome/Edge/Brave "installed app" windows carry the web app id.
    if command_line.contains("--app-id=") {
        if let Some(icon_path) = find_browser_pwa_icon(process_path, command_line) {
            if let Some(icon) = crate::utils::image_file_to_base64(&icon_path) {
                return Some(icon);
            }
        }
    }
    None
}

/// Browser web app ids are 32 characters from the range a-p.
pub(crate) fn browser_web_app_id_from_aumid(id: &str) -> Option<String> {
    let is_web_app_id = |s: &str| s.len() == 32 && s.bytes().all(|b| (b'a'..=b'p').contains(&b));
    if let Some(segment) = id.rsplit('.').next() {
        if is_web_app_id(segment) {
            return Some(segment.to_string());
        }
    }
    if let Some(idx) = id.find("_crx_") {
        if let Some(segment) = id[idx + 5..].split('.').next() {
            if is_web_app_id(segment) {
                return Some(segment.to_string());
            }
        }
    }
    None
}

/// True when a window AppUserModelID belongs to a browser-hosted app (installed
/// PWA or Store PWA) instead of the browser itself. Regular Chromium windows
/// carry only the browser id ("Chrome", "MSEdge", "Brave", ...), while PWA
/// windows carry a web app id or a p…21396 tokens truncated…:core::HRESULT;
        type ReleaseFn = unsafe extern "system" fn(*mut std::ffi::c_void) -> u32;

        let set_state: SetSystemRadioStateFn = std::mem::transmute(*vtable_ptr.add(6));
        let release: ReleaseFn = std::mem::transmute(*vtable_ptr.add(2));

        // bEnabled: 0 = disable radios (Airplane mode ON), 1 = enable radios (Airplane mode OFF)
        let b_enabled = if airplane_mode { 0 } else { 1 };
        let hr_call = set_state(radio_manager_ptr, b_enabled);
        release(radio_manager_ptr);

        if hr_call.is_ok() {
            Ok(())
        } else {
            Err(format!("SetSystemRadioState failed: {:?}", hr_call))
        }
    }
}

fn get_airplane_mode_registry() -> Option<bool> {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_LOCAL_MACHINE, KEY_READ,
    };
    use windows::core::w;
    unsafe {
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        if RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            w!("SYSTEM\\CurrentControlSet\\Control\\RadioManagement\\SystemRadioState"),
            None,
            KEY_READ,
            &mut hkey,
        )
        .is_ok()
        {
            let mut data: u32 = 0;
            let mut size: u32 = std::mem::size_of::<u32>() as u32;
            let res = RegQueryValueExW(
                hkey,
                windows::core::PCWSTR::null(),
                None,
                None,
                Some(&mut data as *mut u32 as *mut u8),
                Some(&mut size),
            );
            let _ = RegCloseKey(hkey);
            if res.is_ok() {
                return Some(data != 0);
            }
        }
    }
    None
}

fn get_airplane_mode_sync() -> bool {
    if let Some(state) = get_system_radio_state_com() {
        AIRPLANE_MODE_ENABLED.store(state, Ordering::Relaxed);
        return state;
    }
    if let Some(state) = get_airplane_mode_registry() {
        AIRPLANE_MODE_ENABLED.store(state, Ordering::Relaxed);
        return state;
    }
    AIRPLANE_MODE_ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub async fn get_airplane_mode_state() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(get_airplane_mode_sync)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_airplane_mode() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let current_state = get_airplane_mode_sync();
        let target_airplane = !current_state;

        // Use native RadioManagement API
        let _ = set_system_radio_state_com(target_airplane);

        // Also ensure individual hardware radios follow immediately
        if target_airplane {
            let _ = set_radio_state_sync(windows::Devices::Radios::RadioKind::WiFi, false);
            let _ = set_radio_state_sync(windows::Devices::Radios::RadioKind::Bluetooth, false);
        } else {
            let _ = set_radio_state_sync(windows::Devices::Radios::RadioKind::WiFi, true);
        }

        AIRPLANE_MODE_ENABLED.store(target_airplane, Ordering::Relaxed);
        Ok(target_airplane)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn get_battery_saver_state_sync() -> bool {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    if let Ok(output) = Command::new("powercfg")
        .arg("/getactivescheme")
        .creation_flags(0x08000000)
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        return text.to_lowercase().contains("a1841308-3541-4fab-bc81-f71556f20b4a")
            || text.to_lowercase().contains("power saver");
    }
    false
}

#[tauri::command]
pub fn toggle_battery_saver() -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let is_saver = get_battery_saver_state_sync();
    let target_guid = if is_saver {
        "381b4222-f694-41f0-9685-ff5bb260df2e"
    } else {
        "a1841308-3541-4fab-bc81-f71556f20b4a"
    };
    let _ = Command::new("powercfg")
        .args(["/setactive", target_guid])
        .creation_flags(0x08000000)
        .status();
    Ok(!is_saver)
}

#[tauri::command]
pub fn get_dnd_state() -> Result<bool, String> {
    use windows::Win32::System::Registry::{RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ};
    use windows::core::w;

    unsafe {
        let mut key = HKEY::default();
        let subkey = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings");
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey, Some(0), KEY_READ, &mut key).is_ok() {
            let val_name = w!("NOC_GLOBAL_SETTING_TOASTS_ENABLED");
            let mut val: u32 = 1;
            let mut size = std::mem::size_of::<u32>() as u32;
            let res = RegQueryValueExW(key, val_name, None, None, Some(&mut val as *mut u32 as *mut u8), Some(&mut size));
            let _ = windows::Win32::System::Registry::RegCloseKey(key);
            if res.is_ok() {
                return Ok(val == 0);
            }
        }
        Ok(false)
    }
}

#[tauri::command]
pub fn toggle_dnd_state() -> Result<bool, String> {
    use windows::Win32::System::Registry::{RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_ALL_ACCESS, REG_DWORD, REG_OPTION_NON_VOLATILE};
    use windows::core::w;

    let current = get_dnd_state().unwrap_or(false);
    let next_dnd = !current;
    let toasts_enabled: u32 = if next_dnd { 0 } else { 1 };

    unsafe {
        let mut key = HKEY::default();
        let subkey = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings");
        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            subkey,
            Some(0),
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_ALL_ACCESS,
            None,
            &mut key,
            None,
        ).is_ok() {
            let val_name = w!("NOC_GLOBAL_SETTING_TOASTS_ENABLED");
            let _ = RegSetValueExW(
                key,
                val_name,
                Some(0),
                REG_DWORD,
                Some(std::slice::from_raw_parts(&toasts_enabled as *const u32 as *const u8, 4)),
            );
            let _ = windows::Win32::System::Registry::RegCloseKey(key);

            use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
            let _ = SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                windows::Win32::Foundation::WPARAM(0),
                windows::Win32::Foundation::LPARAM(w!("TraySettings").as_ptr() as isize),
                SMTO_ABORTIFHUNG,
                100,
                None,
            );
        }
    }
    Ok(next_dnd)
}

static HOTSPOT_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn get_mobile_hotspot_state() -> bool {
    HOTSPOT_ACTIVE.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn toggle_mobile_hotspot() -> Result<bool, String> {
    let current = HOTSPOT_ACTIVE.load(Ordering::Relaxed);
    let next = !current;
    HOTSPOT_ACTIVE.store(next, Ordering::Relaxed);

    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let action = if next { "start" } else { "stop" };
    let _ = Command::new("netsh")
        .args(["wlan", action, "hostednetwork"])
        .creation_flags(0x08000000)
        .status();

    Ok(next)
}

#[tauri::command]
pub fn toggle_ethernet_state() -> Result<bool, String> {
    let connected = is_ethernet_connected_sync();
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let action = if connected { "admin=disable" } else { "admin=enable" };
    let _ = Command::new("netsh")
        .args(["interface", "set", "interface", "Ethernet", action])
        .creation_flags(0x08000000)
        .status();
    Ok(!connected)
}

#[tauri::command]
pub fn get_audio_devices() -> Result<crate::types::AudioDeviceStatus, String> {
    use windows::Win32::Media::Audio::IMMDeviceEnumerator;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator = CoCreateInstance::<_, IMMDeviceEnumerator>(
            &windows::Win32::Media::Audio::MMDeviceEnumerator,
            None,
            CLSCTX_ALL,
        )
        .map_err(|e| e.to_string())?;

        Ok(crate::services::query_audio_devices_status(&enumerator))
    }
}

// --- System metrics for status widgets ---

#[tauri::command]
pub fn get_cpu_usage() -> Result<u32, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST_IDLE: AtomicU64 = AtomicU64::new(0);
    static LAST_KERNEL: AtomicU64 = AtomicU64::new(0);
    static LAST_USER: AtomicU64 = AtomicU64::new(0);

    unsafe {
        let mut idle = windows::Win32::Foundation::FILETIME::default();
        let mut kernel = windows::Win32::Foundation::FILETIME::default();
        let mut user = windows::Win32::Foundation::FILETIME::default();
        windows::Win32::System::Threading::GetSystemTimes(
            Some(&mut idle),
            Some(&mut kernel),
            Some(&mut user),
        )
        .map_err(|e| format!("GetSystemTimes failed: {e}"))?;

        let idle_u64 = (idle.dwHighDateTime as u64) << 32 | idle.dwLowDateTime as u64;
        let kernel_u64 = (kernel.dwHighDateTime as u64) << 32 | kernel.dwLowDateTime as u64;
        let user_u64 = (user.dwHighDateTime as u64) << 32 | user.dwLowDateTime as u64;

        let prev_idle = LAST_IDLE.swap(idle_u64, Ordering::Relaxed);
        let prev_kernel = LAST_KERNEL.swap(kernel_u64, Ordering::Relaxed);
        let prev_user = LAST_USER.swap(user_u64, Ordering::Relaxed);

        let idle_delta = idle_u64.saturating_sub(prev_idle);
        let kernel_delta = kernel_u64.saturating_sub(prev_kernel);
        let user_delta = user_u64.saturating_sub(prev_user);
        let total = kernel_delta + user_delta;

        if total == 0 {
            return Ok(0);
        }
        let usage = ((total - idle_delta) * 100) / total;
        Ok(usage as u32)
    }
}

#[tauri::command]
pub fn get_ram_usage() -> Result<f32, String> {
    unsafe {
        let mut mem = windows::Win32::System::SystemInformation::MEMORYSTATUSEX::default();
        mem.dwLength =
            std::mem::size_of::<windows::Win32::System::SystemInformation::MEMORYSTATUSEX>() as u32;
        windows::Win32::System::SystemInformation::GlobalMemoryStatusEx(&mut mem)
            .map_err(|e| format!("GlobalMemoryStatusEx failed: {e}"))?;
        Ok(mem.dwMemoryLoad as f32)
    }
}

#[tauri::command]
pub fn get_disk_space() -> Result<u64, String> {
    unsafe {
        let mut free_bytes = 0u64;
        let mut total_bytes = 0u64;
        let mut total_free = 0u64;
        windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            windows::core::w!("C:\\"),
            Some(&mut free_bytes),
            Some(&mut total_bytes),
            Some(&mut total_free),
        )
        .map_err(|e| format!("GetDiskFreeSpaceEx failed: {e}"))?;
        Ok(free_bytes / (1024 * 1024 * 1024))
    }
}

#[tauri::command]
pub fn get_network_speed() -> Result<(u64, u64), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST_BYTES_SENT: AtomicU64 = AtomicU64::new(0);
    static LAST_BYTES_RECV: AtomicU64 = AtomicU64::new(0);
    static LAST_CHECK: AtomicU64 = AtomicU64::new(0);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let last_check = LAST_CHECK.load(Ordering::Relaxed);
    let elapsed = if last_check > 0 {
        (now - last_check).max(1)
    } else {
        1000
    };

    let (mut total_in, mut total_out) = (0u64, 0u64);
    unsafe {
        let mut table_ptr: *mut windows::Win32::NetworkManagement::IpHelper::MIB_IF_TABLE2 =
            std::ptr::null_mut();
        let ret = windows::Win32::NetworkManagement::IpHelper::GetIfTable2(&mut table_ptr);
        if ret.is_ok() && !table_ptr.is_null() {
            let table = &*table_ptr;
            let num_entries = table.NumEntries;
            let rows = table.Table.as_ptr();
            for i in 0..num_entries as usize {
                let row = &*rows.add(i);
                total_in += row.InOctets;
                total_out += row.OutOctets;
            }
            windows::Win32::NetworkManagement::IpHelper::FreeMibTable(table_ptr as *const _);
        }
    }

    let prev_sent = LAST_BYTES_SENT.swap(total_out, Ordering::Relaxed);
    let prev_recv = LAST_BYTES_RECV.swap(total_in, Ordering::Relaxed);
    LAST_CHECK.store(now, Ordering::Relaxed);

    if last_check == 0 {
        return Ok((0, 0));
    }

    let sent_per_sec = if total_out > prev_sent {
        ((total_out - prev_sent) * 1000) / elapsed
    } else {
        0
    };
    let recv_per_sec = if total_in > prev_recv {
        ((total_in - prev_recv) * 1000) / elapsed
    } else {
        0
    };

    Ok((sent_per_sec, recv_per_sec))
}

#[tauri::command]
pub fn get_windows_accent_color() -> Option<String> {
    unsafe {
        use windows::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ, REG_BINARY,
            REG_DWORD,
        };

        // 1. Try reading AccentPalette from Explorer\Accent for the true system accent color
        let subkey =
            windows::core::w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent");
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey, Some(0), KEY_READ, &mut hkey).is_ok() {
            let mut value_type = REG_BINARY;
            let mut palette = [0u8; 32];
            let mut value_size = 32u32;
            let val_name = windows::core::w!("AccentPalette");
            if RegQueryValueExW(
                hkey,
                val_name,
                None,
                Some(&mut value_type),
                Some(palette.as_mut_ptr()),
                Some(&mut value_size),
            )
            .is_ok()
            {
                let _ = RegCloseKey(hkey);
                if value_size >= 15 {
                    // bytes 12, 13, 14 are R, G, B of the active accent color
                    let r = palette[12];
                    let g = palette[13];
                    let b = palette[14];
                    return Some(format!("#{:02x}{:02x}{:02x}", r, g, b));
                }
            } else {
                let _ = RegCloseKey(hkey);
            }
        }

        // 2. Fallback to DWM\AccentColor
        let subkey = windows::core::w!("Software\\Microsoft\\Windows\\DWM");
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey, Some(0), KEY_READ, &mut hkey).is_ok() {
            let mut value_type = REG_DWORD;
            let mut color_val = 0u32;
            let mut value_size = std::mem::size_of::<u32>() as u32;
            let val_name = windows::core::w!("AccentColor");
            if RegQueryValueExW(
                hkey,
                val_name,
                None,
                Some(&mut value_type),
                Some(&mut color_val as *mut u32 as *mut u8),
                Some(&mut value_size),
            )
            .is_ok()
            {
                let _ = RegCloseKey(hkey);
                // color_val is AABBGGRR (ABGR format)
                let r = (color_val & 0xff) as u8;
                let g = ((color_val >> 8) & 0xff) as u8;
                let b = ((color_val >> 16) & 0xff) as u8;
                return Some(format!("#{:02x}{:02x}{:02x}", r, g, b));
            }
            let _ = RegCloseKey(hkey);
        }
    }
    None
}

#[tauri::command]
pub fn get_system_accent_color() -> Result<String, String> {
    // Try reading registry first for exact Windows accent color
    if let Some(color) = get_windows_accent_color() {
        return Ok(color);
    }

    // Fallback to DwmGetColorizationColor
    unsafe {
        let mut color = 0u32;
        let mut opaque = windows::core::BOOL(0);
        if windows::Win32::Graphics::Dwm::DwmGetColorizationColor(&mut color, &mut opaque).is_ok() {
            let r = ((color >> 16) & 0xff) as u8;
            let g = ((color >> 8) & 0xff) as u8;
            let b = (color & 0xff) as u8;
            let hex = format!("#{:02x}{:02x}{:02x}", r, g, b);
            Ok(hex)
        } else {
            Err("Failed to query colorization color".into())
        }
    }
}

#[tauri::command]
pub fn export_settings(app: AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");
    if let Ok(content) = std::fs::read_to_string(&path) {
        // Validate it's valid JSON before returning
        let _settings: HashMap<String, serde_json::Value> =
            serde_json::from_str(&content).map_err(|e| format!("Invalid settings file: {}", e))?;
        Ok(content)
    } else {
        Err("No settings file found".into())
    }
}

#[tauri::command]
pub fn read_settings_from_path(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn write_settings_to_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub fn import_settings(app: AppHandle, settings: String) -> Result<(), String> {
    let imported: HashMap<String, serde_json::Value> =
        serde_json::from_str(&settings).map_err(|e| format!("Invalid JSON: {}", e))?;

    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let previous: HashMap<String, serde_json::Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default();

    let content = serde_json::to_string_pretty(&imported).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;

    crate::utils::replace_settings_cache(imported.clone());

    // Broadcast changes for every imported key so all windows re-sync
    for (key, value) in &imported {
        let _ = app.emit(
            "settings-changed",
            serde_json::json!({ "key": key, "value": value }),
        );
    }

    // Keys the imported file doesn't have must leave each window's localStorage
    // mirror too, or they come back from it on the next start. Same sentinels
    // as reset_settings are kept.
    let keep = ["bloom-first-run", "bloom-app-version"];
    for key in previous.keys().filter(|key| {
        key.starts_with("bloom-") && !keep.contains(&key.as_str()) && !imported.contains_key(*key)
    }) {
        let _ = app.emit(
            "settings-external-changed",
            serde_json::json!({ "key": key, "value": null }),
        );
    }

    if imported.contains_key("bloom-scale")
        || imported.contains_key("bloom-notch-scale")
        || imported.contains_key("bloom-dock-scale")
    {
        re_register_appbars(&app, &imported);
    }

    Ok(())
}

#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Keep non-Bloom keys (the file is user-editable) and the first-run/version
    // sentinels (lifecycle markers, not preferences â€” keeping them avoids
    // replaying the splash after a reset). Everything else falls back to
    // defaults in both the backend and the frontends.
    let keep = ["bloom-first-run", "bloom-app-version"];
    let mut settings: HashMap<String, serde_json::Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default();
    let removed: Vec<String> = settings
        .keys()
        .filter(|key| key.starts_with("bloom-") && !keep.contains(&key.as_str()))
        .cloned()
        .collect();
    for key in &removed {
        settings.remove(key);
    }

    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    crate::utils::replace_settings_cache(settings);

    // Mirror the external-edit watcher so every open window drops the removed
    // keys from localStorage. The caller restarts Bloom right after, but this
    // keeps the reset correct even if a window lingers.
    for key in removed {
        let _ = app.emit(
            "settings-external-changed",
            serde_json::json!({ "key": key, "value": null }),
        );
    }
    Ok(())
}

pub fn setup_settings_watcher(app: AppHandle) {
    use tauri::Manager;

    let config_dir = match app.path().app_config_dir() {
        Ok(p) => p,
        Err(_) => return,
    };
    let settings_path = config_dir.join("settings.json");

    // Initialize SETTINGS_CACHE if not yet set (backup for race with init_settings_cache)
    let _ = crate::state::SETTINGS_CACHE.set(std::sync::Mutex::new(HashMap::new()));

    std::thread::spawn(move || {
        use windows::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows::Win32::Storage::FileSystem::{
            CreateFileW, ReadDirectoryChangesW, FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY,
            FILE_NOTIFY_CHANGE_LAST_WRITE, OPEN_EXISTING,
        };
        use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};
        use windows::Win32::System::IO::OVERLAPPED;

        unsafe {
            let dir_path: Vec<u16> = config_dir
                .to_string_lossy()
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();

            let dir_handle = match CreateFileW(
                windows::core::PCWSTR(dir_path.as_ptr()),
                FILE_LIST_DIRECTORY.0,
                windows::Win32::Storage::FileSystem::FILE_SHARE_READ
                    | windows::Win32::Storage::FileSystem::FILE_SHARE_WRITE
                    | windows::Win32::Storage::FileSystem::FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            ) {
                Ok(h) if h != INVALID_HANDLE_VALUE => h,
                _ => return,
            };

            let h_event = match CreateEventW(None, false, false, None) {
                Ok(e) => e,
                Err(_) => {
                    let _ = CloseHandle(dir_handle);
                    return;
                }
            };

            let mut notify_buffer = [0u8; 4096];
            let mut bytes_returned = 0u32;
            let mut overlapped = OVERLAPPED::default();
            overlapped.hEvent = h_event;

            loop {
                let success = ReadDirectoryChangesW(
                    dir_handle,
                    notify_buffer.as_mut_ptr() as *mut _,
                    notify_buffer.len() as u32,
                    false,
                    FILE_NOTIFY_CHANGE_LAST_WRITE,
                    Some(&mut bytes_returned),
                    Some(&mut overlapped),
                    None,
                );

                if success.is_err() {
                    break;
                }

                WaitForSingleObject(h_event, INFINITE);

                std::thread::sleep(std::time::Duration::from_millis(200));

                if let Ok(new_content) = std::fs::read_to_string(&settings_path) {
                    if let Ok(new_settings) =
                        serde_json::from_str::<HashMap<String, serde_json::Value>>(&new_content)
                    {
                        // Collect diffs while holding the lock, then drop before emitting
                        let (changed, removed) = {
                            let mut cache = crate::state::SETTINGS_CACHE
                                .get_or_init(|| std::sync::Mutex::new(HashMap::new()))
                                .lock()
                                .unwrap();

                            let mut changed = Vec::new();
                            for (key, value) in &new_settings {
                                if cache.get(key) != Some(value) {
                                    changed.push((key.clone(), value.clone()));
                                }
                            }

                            let removed: Vec<String> = cache
                                .keys()
                                .filter(|k| !new_settings.contains_key(*k))
                                .cloned()
                                .collect();

                            *cache = new_settings.clone();
                            (changed, removed)
                        };
                        // Lock dropped â€” safe to emit without blocking save_setting
                        for (key, value) in &changed {
                            let _ = app.emit(
                                "settings-external-changed",
                                serde_json::json!({ "key": key, "value": value }),
                            );
                        }
                        for key in removed {
                            let _ = app.emit(
                                "settings-external-changed",
                                serde_json::json!({ "key": key, "value": null }),
                            );
                        }
                    }
                }
            }

            let _ = CloseHandle(h_event);
            let _ = CloseHandle(dir_handle);
        }
    });
}

#[cfg(test)]
mod pwa_icon_tests {
    use super::*;

    #[test]
    fn bloom_launch_targets_reuse_the_running_settings_window() {
        let identifier = "com.sehaz.bloom";
        assert!(is_bloom_launch_target(identifier, identifier));
        assert!(is_bloom_launch_target("bloom-settings", identifier));
        assert!(is_bloom_launch_target(
            "C:\\Users\\test\\AppData\\Local\\bloom\\bloom.exe",
            identifier
        ));
        assert!(!is_bloom_launch_target("C:\\Apps\\Discord.exe", identifier));
        assert!(!is_bloom_launch_target("com.other.app", identifier));
    }

    #[test]
    fn aumid_detection() {
        assert!(is_aumid_path("4DF9E0F8.Netflix_mcm4njqhnhss8!Netflix.App"));
        assert!(is_aumid_path("Microsoft.VisualStudioCode"));
        assert!(is_aumid_path(
            "shell:AppsFolder\\4DF9E0F8.Netflix_mcm4njqhnhss8!Netflix.App"
        ));
        assert!(!is_aumid_path("C:\\Windows\\explorer.exe"));
        assert!(!is_aumid_path("msedge.exe"));
        assert!(!is_aumid_path(""));
    }

    #[test]
    fn command_line_arg_parsing() {
        let args = "--profile-directory=\"Profile 1\" --app-id=abcdef --ip-aumid=Package_Pub!App";
        assert_eq!(extract_arg(args, "--app-id="), Some("abcdef".into()));
        assert_eq!(
            extract_arg(args, "--profile-directory="),
            Some("Profile 1".into())
        );
        assert_eq!(
            extract_arg(args, "--ip-aumid="),
            Some("Package_Pub!App".into())
        );
        assert_eq!(extract_arg(args, "--missing="), None);
        assert_eq!(
            extract_arg(
                "shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
                "shell:AppsFolder\\"
            ),
            Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App".into())
        );
    }

    #[test]
    fn package_family_from_paths() {
        assert_eq!(
            package_family_from_windows_apps_path("C:\\Program Files\\WindowsApps\\5319275A.WhatsAppDesktop_2.2634.101.0_x64__cv1g1gvanyjgm\\WhatsApp.Root.exe").as_deref(),
            Some("5319275A.WhatsAppDesktop_cv1g1gvanyjgm")
        );
        assert_eq!(
            package_family_from_windows_apps_path("C:\\Windows\\explorer.exe"),
            None
        );
        assert_eq!(
            package_family_from_windows_apps_path("C:\\Program Files\\App\\app.exe"),
            None
        );
    }

    #[test]
    fn browser_web_app_ids_from_aumids() {
        assert_eq!(
            browser_web_app_id_from_aumid("Chrome.edhbnieanoeijlkpgkminebadpibapgm").as_deref(),
            Some("edhbnieanoeijlkpgkminebadpibapgm")
        );
        assert_eq!(
            browser_web_app_id_from_aumid("Chrome._crx_edhbnieanoeijlkpgkminebadpibapgm")
                .as_deref(),
            Some("edhbnieanoeijlkpgkminebadpibapgm")
        );
        assert_eq!(
            browser_web_app_id_from_aumid("4DF9E0F8.Netflix_mcm4njqhnhss8!Netflix.App"),
            None
        );
        assert_eq!(browser_web_app_id_from_aumid("MSEdge"), None);
    }

    #[test]
    fn browser_pwa_aumid_detection() {
        assert!(is_browser_pwa_aumid(
            "Chrome.edhbnieanoeijlkpgkminebadpibapgm"
        ));
        assert!(is_browser_pwa_aumid(
            "Brave._crx_edhbnieanoeijlkpgkminebadpibapgm"
        ));
        assert!(is_browser_pwa_aumid(
            "Brave._crx_agimnkijcamfeangaknmldooml"
        ));
        assert!(is_browser_pwa_aumid(
            "4DF9E0F8.Netflix_mcm4njqhnhss8!Netflix.App"
        ));
        assert!(!is_browser_pwa_aumid("MSEdge"));
        assert!(!is_browser_pwa_aumid("Chrome"));
        assert!(!is_browser_pwa_aumid("Brave"));
    }

    #[test]
    fn image_size_scoring_prefers_larger_dimensions() {
        use std::path::Path;
        assert!(
            image_size_score(Path::new("C:\\x\\Icons\\256.png"))
                > image_size_score(Path::new("C:\\x\\Icons\\64.png"))
        );
        assert!(
            image_size_score(Path::new("C:\\x\\512x512.png"))
                > image_size_score(Path::new("C:\\x\\192x192.png"))
        );
        assert_eq!(image_size_score(Path::new("C:\\x\\icon.png")), 0);
    }

    #[test]
    fn pwa_shortcut_matching() {
        let app = AppInfo {
            name: "YouTube".into(),
            path: "C:\\Users\\x\\Start Menu\\Programs\\YouTube.lnk".into(),
            icon: None,
            is_running: false,
            hwnd: None,
            executable: Some("brave.exe".into()),
            all_hwnds: None,
        };
        assert!(is_pwa_shortcut_for(&app, "youtube", "brave.exe"));
        assert!(is_pwa_shortcut_for(&app, "YouTube", "BRAVE.EXE"));
        assert!(!is_pwa_shortcut_for(&app, "YouTube", "msedge.exe"));
        assert!(!is_pwa_shortcut_for(&app, "YouTube Music", "brave.exe"));
    }

    #[test]
    fn pwa_launch_target_resolution() {
        // Non-browser paths and missing titles never resolve through the cache.
        assert_eq!(
            pwa_launch_target("C:\\Windows\\notepad.exe", Some("Notepad")),
            None
        );
        assert_eq!(
            pwa_launch_target(
                "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
                None
            ),
            None
        );
        assert_eq!(
            pwa_launch_target(
                "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
                Some("   ")
            ),
            None
        );

        // With the installed-apps cache populated, a running PWA resolves to its
        // Start Menu shortcut and a same-titled app under another browser does not.
        let _ = INSTALLED_APPS_CACHE.set(std::sync::Mutex::new(vec![
            AppInfo {
                name: "YouTube".into(),
                path: "C:\\Start Menu\\YouTube.lnk".into(),
                icon: None,
                is_running: false,
                hwnd: None,
                executable: Some("brave.exe".into()),
                all_hwnds: None,
            },
            AppInfo {
                name: "Netflix".into(),
                path: "C:\\Start Menu\\Netflix.lnk".into(),
                icon: None,
                is_running: false,
                hwnd: None,
                executable: Some("msedge.exe".into()),
                all_hwnds: None,
            },
        ]));
        assert_eq!(
            pwa_launch_target(
                "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
                Some("YouTube")
            ),
            Some("C:\\Start Menu\\YouTube.lnk".into())
        );
        assert_eq!(
            pwa_launch_target(
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                Some("YouTube")
            ),
            None
        );
        assert_eq!(
            pwa_launch_target(
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                Some("Netflix")
            ),
            Some("C:\\Start Menu\\Netflix.lnk".into())
        );
    }
}

#[tauri::command]
pub async fn get_tray_apps() -> Vec<crate::tray::TrayApp> {
    tauri::async_runtime::spawn_blocking(crate::tray::enumerate)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn show_tray_context_menu(tray_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::tray::interact(&tray_id, true))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SystemAction {
    TaskManager,
    DiskManagement,
    DeviceManager,
    ComputerManagement,
    Settings,
    TaskbarSettings,
    InstalledApps,
    PowerOptions,
    NetworkConnections,
}

#[tauri::command]
pub async fn open_system_action(action: SystemAction) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let mut directory = [0u16; 32768];
        let length =
            windows::Win32::System::SystemInformation::GetSystemDirectoryW(Some(&mut directory));
        if length == 0 || length as usize >= directory.len() {
            return Err("Windows system directory is unavailable.".into());
        }
        let system = String::from_utf16_lossy(&directory[..length as usize]);
        let (file, args) = match action {
            SystemAction::TaskManager => (format!("{system}\\Taskmgr.exe"), String::new()),
            SystemAction::DiskManagement => (
                format!("{system}\\mmc.exe"),
                format!("\"{system}\\diskmgmt.msc\""),
            ),
            SystemAction::DeviceManager => (
                format!("{system}\\mmc.exe"),
                format!("\"{system}\\devmgmt.msc\""),
            ),
            SystemAction::ComputerManagement => (
                format!("{system}\\mmc.exe"),
                format!("\"{system}\\compmgmt.msc\""),
            ),
            SystemAction::Settings => ("ms-settings:".into(), String::new()),
            SystemAction::TaskbarSettings => ("ms-settings:taskbar".into(), String::new()),
            SystemAction::InstalledApps => ("ms-settings:appsfeatures".into(), String::new()),
            SystemAction::PowerOptions => ("ms-settings:powersleep".into(), String::new()),
            SystemAction::NetworkConnections => ("ms-settings:network".into(), String::new()),
        };
        let file: Vec<u16> = file.encode_utf16().chain(Some(0)).collect();
        let args: Vec<u16> = args.encode_utf16().chain(Some(0)).collect();
        let result = ShellExecuteW(
            None,
            windows::core::w!("open"),
            windows::core::PCWSTR(file.as_ptr()),
            windows::core::PCWSTR(args.as_ptr()),
            windows::core::PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        if result.0 as usize <= 32 {
            Err("Windows could not open this system tool.".into())
        } else {
            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn activate_tray_icon(tray_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::tray::interact(&tray_id, false))
        .await
        .map_err(|e| e.to_string())?
}

fn fuzzy_match_simple(pattern: &str, target: &str) -> bool {
    if pattern.is_empty() {
        return true;
    }
    let p_lower = pattern.to_lowercase();
    let t_lower = target.to_lowercase();
    if t_lower.contains(&p_lower) {
        return true;
    }
    let mut p_chars = p_lower.chars();
    let mut current = match p_chars.next() {
        Some(c) => c,
        None => return true,
    };
    for tc in t_lower.chars() {
        if tc == current {
            match p_chars.next() {
                Some(next) => current = next,
                None => return true,
            }
        }
    }
    false
}

#[tauri::command]
pub async fn search_user_files(query: String) -> Vec<SearchFileItem> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let query_lower = query.trim().to_lowercase();

        let user_profile = match std::env::var("USERPROFILE") {
            Ok(val) => val,
            Err(_) => return results,
        };

        let user_path = std::path::Path::new(&user_profile);
        let standard_folders = [
            ("Desktop", user_path.join("Desktop")),
            ("Downloads", user_path.join("Downloads")),
            ("Documents", user_path.join("Documents")),
            ("Pictures", user_path.join("Pictures")),
            ("Music", user_path.join("Music")),
            ("Videos", user_path.join("Videos")),
        ];

        // 1. Standard folders
        for (name, path) in &standard_folders {
            if path.exists() && fuzzy_match_simple(&query_lower, name) {
                results.push(SearchFileItem {
                    name: name.to_string(),
                    path: path.to_string_lossy().to_string(),
                    is_dir: true,
                    ext: None,
                });
            }
        }

        // 2. Scan items inside Desktop, Downloads, Documents
        let search_folders = [
            user_path.join("Desktop"),
            user_path.join("Downloads"),
            user_path.join("Documents"),
        ];

        for folder in &search_folders {
            if let Ok(entries) = std::fs::read_dir(folder) {
                let mut count = 0;
                for entry in entries.flatten() {
                    if count >= 35 {
                        break;
                    }
                    let p = entry.path();
                    let file_name = p
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    if file_name.starts_with('.')
                        || file_name.eq_ignore_ascii_case("desktop.ini")
                    {
                        continue;
                    }

                    if fuzzy_match_simple(&query_lower, &file_name) {
                        let is_dir = p.is_dir();
                        let ext = p.extension().map(|e| e.to_string_lossy().to_string());
                        results.push(SearchFileItem {
                            name: file_name,
                            path: p.to_string_lossy().to_string(),
                            is_dir,
                            ext,
                        });
                        count += 1;
                    }
                }
            }
        }

        // 3. Scan Windows Recent items if available
        let recent_path = user_path
            .join("AppData")
            .join("Roaming")
            .join("Microsoft")
            .join("Windows")
            .join("Recent");
        if recent_path.exists() {
            if let Ok(entries) = std::fs::read_dir(&recent_path) {
                let mut recent_count = 0;
                for entry in entries.flatten() {
                    if recent_count >= 20 {
                        break;
                    }
                    let p = entry.path();
                    let file_name = p
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    if file_name.starts_with('.')
                        || file_name.eq_ignore_ascii_case("desktop.ini")
                    {
                        continue;
                    }

                    let clean_name = file_name.strip_suffix(".lnk").unwrap_or(&file_name).to_string();
                    if fuzzy_match_simple(&query_lower, &clean_name) {
                        results.push(SearchFileItem {
                            name: clean_name,
                            path: p.to_string_lossy().to_string(),
                            is_dir: false,
                            ext: Some("lnk".into()),
                        });
                        recent_count += 1;
                    }
                }
            }
        }

        results.truncate(50);
        results
    })
    .await
    .unwrap_or_default()
}

// ==========================================
// Control Center Modernization Commands
// ==========================================

#[tauri::command]
pub async fn get_internet_status() -> Result<InternetStatus, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<InternetStatus, String> {
        let ethernet_connected = is_ethernet_connected_sync();
        let (wifi_enabled, wifi_connected, ssid) = get_wlan_status_fast();

        let (connection_type, label, is_connected) = if ethernet_connected {
            ("ethernet".to_string(), "Ethernet".to_string(), true)
        } else if wifi_connected {
            let display_ssid = if ssid.is_empty() { "Wi-Fi".to_string() } else { ssid };
            ("wifi".to_string(), display_ssid, true)
        } else {
            ("offline".to_string(), "No internet".to_string(), false)
        };

        Ok(InternetStatus {
            connection_type,
            label,
            is_connected,
            ethernet_connected,
            wifi_connected,
            wifi_enabled,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_available_wifi_networks() -> Result<Vec<WifiNetworkEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<WifiNetworkEntry>, String> {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let (_, current_ssid) = get_wlan_connection_info_sync();

        let output = Command::new("netsh")
            .args(["wlan", "show", "networks", "mode=bssid"])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;

        let text = String::from_utf8_lossy(&output.stdout);
        let mut networks: Vec<WifiNetworkEntry> = Vec::new();
        let mut current_entry: Option<WifiNetworkEntry> = None;

        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("SSID ") {
                if let Some(entry) = current_entry.take() {
                    if !entry.ssid.is_empty() && !networks.iter().any(|n| n.ssid == entry.ssid) {
                        networks.push(entry);
                    }
                }
                if let Some(idx) = trimmed.find(':') {
                    let ssid = trimmed[idx + 1..].trim().to_string();
                    if !ssid.is_empty() {
                        let is_conn = !current_ssid.is_empty() && ssid.eq_ignore_ascii_case(&current_ssid);
                        current_entry = Some(WifiNetworkEntry {
                            ssid,
                            signal_percent: 50,
                            is_secure: true,
                            is_connected: is_conn,
                        });
                    }
                }
            } else if let Some(ref mut entry) = current_entry {
                if trimmed.starts_with("Authentication") {
                    if let Some(idx) = trimmed.find(':') {
                        let auth = trimmed[idx + 1..].trim();
                        entry.is_secure = !auth.eq_ignore_ascii_case("Open");
                    }
                } else if trimmed.starts_with("Signal") {
                    if let Some(idx) = trimmed.find(':') {
                        let sig_str = trimmed[idx + 1..].trim().replace('%', "");
                        if let Ok(pct) = sig_str.parse::<u8>() {
                            if pct > entry.signal_percent || entry.signal_percent == 50 {
                                entry.signal_percent = pct;
                            }
                        }
                    }
                }
            }
        }

        if let Some(entry) = current_entry {
            if !entry.ssid.is_empty() && !networks.iter().any(|n| n.ssid == entry.ssid) {
                networks.push(entry);
            }
        }

        networks.sort_by(|a, b| {
            b.is_connected
                .cmp(&a.is_connected)
                .then_with(|| b.signal_percent.cmp(&a.signal_percent))
        });

        Ok(networks)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn connect_wifi_network(ssid: String, _password: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let status = Command::new("netsh")
            .args(["wlan", "connect", &format!("name=\"{}\"", ssid)])
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| e.to_string())?;

        Ok(status.success())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_microphone_state() -> Result<MicrophoneState, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{eCapture, eConsole, IMMDeviceEnumerator};
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
        };

        let com_initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| -> Result<MicrophoneState, String> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(
                &windows::Win32::Media::Audio::MMDeviceEnumerator,
                None,
                CLSCTX_ALL,
            )
            .map_err(|e| e.to_string())?;

            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .map_err(|e| e.to_string())?;

            let endpoint: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| e.to_string())?;

            let is_muted = endpoint.GetMute().map(|m| m.as_bool()).unwrap_or(false);

            Ok(MicrophoneState {
                is_muted,
                device_name: "Default Microphone".to_string(),
            })
        })();

        if com_initialized {
            CoUninitialize();
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_microphone_mute() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{eCapture, eConsole, IMMDeviceEnumerator};
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
        };

        let com_initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| -> Result<bool, String> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(
                &windows::Win32::Media::Audio::MMDeviceEnumerator,
                None,
                CLSCTX_ALL,
            )
            .map_err(|e| e.to_string())?;

            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .map_err(|e| e.to_string())?;

            let endpoint: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| e.to_string())?;

            let current_mute = endpoint.GetMute().map(|m| m.as_bool()).unwrap_or(false);
            let new_mute = !current_mute;
            let _ = endpoint.SetMute(new_mute, std::ptr::null());
            Ok(new_mute)
        })();

        if com_initialized {
            CoUninitialize();
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn trigger_screen_snip() {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let _ = Command::new("cmd")
        .args(["/c", "start", "ms-screenclip:"])
        .creation_flags(0x08000000)
        .spawn();
}

#[tauri::command]
pub fn lock_workstation() {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let _ = Command::new("rundll32.exe")
        .args(["user32.dll,LockWorkStation"])
        .creation_flags(0x08000000)
        .spawn();
}

