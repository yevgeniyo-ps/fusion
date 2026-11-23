// Screenshot of an area the user selects, for the tab's terminal.
//
// The PNG goes into the tab folder (claude's working directory, so claude can read it
// without asking) and onto the clipboard. The frontend pastes its path into the terminal.

use crate::projects::err;
use crate::tab::tab_dir;
use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// The PNG's path, or None when the user pressed Esc.
#[tauri::command]
pub async fn screenshot(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let dir = tab_dir(&app, &id)?.join(".fusion/shots");
    fs::create_dir_all(&dir).map_err(err)?;
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_secs();
    let file = dir.join(format!("shot-{secs}.png"));
    let path = file.to_string_lossy().into_owned();

    tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        // -i: select an area (space switches to a window); Esc writes no file.
        Command::new("/usr/sbin/screencapture").arg("-i").arg(&path).status().map_err(err)?;
        if !file.exists() {
            return Ok(None);
        }
        // The path is an argument, not part of the script: no quoting to get wrong.
        let copied = Command::new("/usr/bin/osascript")
            .args(["-e", "on run argv", "-e", "set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)", "-e", "end run"])
            .arg(&path)
            .status()
            .map_err(err)?;
        if !copied.success() {
            return Err("The screenshot is saved, but it could not go to the clipboard.".into());
        }
        Ok(Some(path))
    })
    .await
    .map_err(err)?
}
