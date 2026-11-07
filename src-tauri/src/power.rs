use std::os::windows::process::CommandExt;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[link(name = "user32")]
extern "system" {
    fn LockWorkStation() -> windows::core::BOOL;
}

#[tauri::command]
pub fn power_shutdown() -> Result<(), String> {
    Command::new("shutdown")
        .args(["/s", "/t", "0"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to initiate shutdown: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn power_restart() -> Result<(), String> {
    Command::new("shutdown")
        .args(["/r", "/t", "0"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to initiate restart: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn power_sleep() -> Result<(), String> {
    Command::new("rundll32.exe")
        .args(["powrprof.dll,SetSuspendState", "0,1,0"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to initiate sleep: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn power_lock() -> Result<(), String> {
    unsafe {
        let res = LockWorkStation();
        if res.as_bool() {
            return Ok(());
        }
    }

    // Fallback via rundll32
    Command::new("rundll32.exe")
        .args(["user32.dll,LockWorkStation"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to lock workstation: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn power_switch_user() -> Result<(), String> {
    Command::new("tsdiscon")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to switch user: {e}"))?;
    Ok(())
}

