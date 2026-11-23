// Files for the editor panes. Every path must be inside a project (Projects::guard).

use crate::projects::{err, Projects};
use serde::Serialize;
use std::fs;
use tauri::State;

/// Larger files open slowly in the editor and are rarely edited by hand.
const MAX_FILE: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    dir: bool,
}

#[tauri::command]
pub fn read_dir(projects: State<Projects>, path: String) -> Result<Vec<Entry>, String> {
    let dir = projects.guard(&path)?;
    let mut out: Vec<Entry> = fs::read_dir(&dir)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name == ".git" || name == ".DS_Store" {
                return None;
            }
            let p = dir.join(&name);
            Some(Entry { dir: p.is_dir(), path: p.to_string_lossy().into_owned(), name })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
pub fn read_file(projects: State<Projects>, path: String) -> Result<String, String> {
    let p = projects.guard(&path)?;
    if fs::metadata(&p).map_err(err)?.len() > MAX_FILE {
        return Err("This file is larger than 5 MB.".into());
    }
    let bytes = fs::read(&p).map_err(err)?;
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Err("This is a binary file.".into());
    }
    // Lossy text would change the file on save, so non-UTF-8 files do not open.
    String::from_utf8(bytes).map_err(|_| "This file is not UTF-8 text.".into())
}

#[tauri::command]
pub fn write_file(projects: State<Projects>, path: String, text: String) -> Result<(), String> {
    let p = projects.guard(&path)?;
    fs::write(p, text).map_err(err)
}
