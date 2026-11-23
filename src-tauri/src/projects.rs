// The projects (checkouts) in the sidebar, and the saved layout of tabs.
//
// Fusion keeps its own list (projects.json): folders added or cloned here, nothing else.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::fs;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    pub path: String,
}

#[derive(Default)]
pub struct Projects(Mutex<Vec<Project>>);

impl Projects {
    /// The projects' paths, as stored (canonical).
    pub fn paths(&self) -> Vec<String> {
        self.0.lock().unwrap().iter().map(|p| p.path.clone()).collect()
    }

    /// The canonical `path`, if it is inside one of the projects. The frontend reads and
    /// writes files only there.
    pub fn guard(&self, path: &str) -> Result<PathBuf, String> {
        let p = fs::canonicalize(path).map_err(err)?;
        let list = self.0.lock().unwrap();
        let inside = list
            .iter()
            .filter_map(|pr| fs::canonicalize(&pr.path).ok())
            .any(|root| p.starts_with(root));
        if inside {
            Ok(p)
        } else {
            Err(format!("{path} is not inside a project"))
        }
    }
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// `~/x` to an absolute path.
pub fn expand(p: &str) -> PathBuf {
    match p.strip_prefix("~") {
        Some(rest) => home().join(rest.trim_start_matches('/')),
        None => PathBuf::from(p),
    }
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&d).map_err(err)?;
    Ok(d)
}

fn name_of(path: &Path) -> String {
    path.file_name().map_or_else(|| path.to_string_lossy().into_owned(), |n| n.to_string_lossy().into_owned())
}

fn own_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("projects.json"))
}

fn save_own(app: &AppHandle, list: &[Project]) -> Result<(), String> {
    fs::write(own_file(app)?, serde_json::to_string_pretty(list).map_err(err)?).map_err(err)
}

#[tauri::command]
pub fn projects_load(app: AppHandle, projects: State<Projects>) -> Result<Vec<Project>, String> {
    let mut list: Vec<Project> = fs::read_to_string(own_file(&app)?)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    list.sort_by_key(|p| p.name.to_lowercase());
    *projects.0.lock().unwrap() = list.clone();
    for p in &list {
        // A folder that is gone has nothing to watch; its pane says so.
        let _ = crate::watch::watch(&app, &p.path);
    }
    Ok(list)
}

pub fn add(app: &AppHandle, projects: &Projects, path: &Path) -> Result<Project, String> {
    let path = fs::canonicalize(path).map_err(err)?;
    let mut list = projects.0.lock().unwrap();
    let key = path.to_string_lossy().into_owned();
    if let Some(p) = list.iter().find(|p| p.path == key) {
        return Ok(p.clone());
    }
    let p = Project { name: name_of(&path), path: key };
    list.push(p.clone());
    list.sort_by_key(|p| p.name.to_lowercase());
    save_own(app, &list)?;
    drop(list);
    crate::watch::watch(app, &p.path)?;
    Ok(p)
}

/// Removes a project from Fusion's list. The folder and its files stay where they are.
#[tauri::command]
pub fn project_remove(app: AppHandle, projects: State<Projects>, path: String) -> Result<(), String> {
    let mut list = projects.0.lock().unwrap();
    list.retain(|p| p.path != path);
    save_own(&app, &list)?;
    drop(list);
    crate::watch::unwatch(&app, &path);
    Ok(())
}

#[tauri::command]
pub fn project_add(app: AppHandle, projects: State<Projects>, path: String) -> Result<Project, String> {
    add(&app, &projects, &expand(&path))
}

/// `git clone` into parent/name. Each progress line from git goes to `on_progress`.
#[tauri::command]
pub async fn project_clone(
    app: AppHandle,
    url: String,
    parent: String,
    name: String,
    on_progress: Channel<String>,
) -> Result<Project, String> {
    let dest = expand(&parent).join(&name);
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    fs::create_dir_all(expand(&parent)).map_err(err)?;
    let target = dest.clone();
    let tail = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut child = Command::new("git")
            .arg("clone")
            .arg("--progress")
            .arg(&url)
            .arg(&target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(err)?;
        // git rewrites one line with \r while it counts: each piece between \r or \n is a line.
        let mut stderr = child.stderr.take().unwrap();
        let mut buf = [0u8; 4096];
        let mut line = String::new();
        let mut last = String::new();
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            for ch in String::from_utf8_lossy(&buf[..n]).chars() {
                if ch == '\r' || ch == '\n' {
                    if !line.trim().is_empty() {
                        let _ = on_progress.send(line.clone());
                        last = std::mem::take(&mut line);
                    }
                    line.clear();
                } else {
                    line.push(ch);
                }
            }
        }
        if child.wait().map_err(err)?.success() {
            Ok(())
        } else {
            Err(if last.is_empty() { "git clone failed".into() } else { last })
        }
    })
    .await
    .map_err(err)?;
    tail?;
    let projects = app.state::<Projects>();
    add(&app, &projects, &dest)
}

/// The tabs and their projects. The frontend owns the shape; this only stores it.
#[tauri::command]
pub fn layout_load(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let f = data_dir(&app)?.join("layout.json");
    Ok(fs::read_to_string(f).ok().and_then(|t| serde_json::from_str(&t).ok()))
}

#[tauri::command]
pub fn layout_save(app: AppHandle, layout: serde_json::Value) -> Result<(), String> {
    let f = data_dir(&app)?.join("layout.json");
    fs::write(f, serde_json::to_string_pretty(&layout).map_err(err)?).map_err(err)
}
