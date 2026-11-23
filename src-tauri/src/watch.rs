// Changes on disk in the projects (claude's edits, git, a build), as "fs-changed" events.
//
// One recursive FSEvents watch per project. Events within 150 ms come as one list of
// paths, so a `git checkout` of 500 files is one event, not 500.

use crate::projects::err;
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, DebouncedEventBatch, Debouncer};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct Watches(Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>);

/// Changes the UI does not show: build and cache folders (they change often and are large),
/// and git's own bookkeeping. .git/HEAD, refs and index stay: a switch, a commit, a `git add`.
fn ignored(p: &Path) -> bool {
    let mut in_git = false;
    for c in p.components() {
        let Some(name) = c.as_os_str().to_str() else { continue };
        if in_git && matches!(name, "objects" | "logs" | "lfs" | "hooks") {
            return true;
        }
        in_git = name == ".git";
        if matches!(
            name,
            "node_modules" | "target" | ".next" | "dist" | ".venv" | "venv" | "__pycache__" | ".ruff_cache" | ".mypy_cache" | ".pytest_cache" | ".terraform" | ".turbo" | ".cache"
        ) {
            return true;
        }
    }
    p.extension().is_some_and(|e| e == "lock") && p.components().any(|c| c.as_os_str() == ".git")
}

pub fn watch(app: &AppHandle, root: &str) -> Result<(), String> {
    let watches = app.state::<Watches>();
    let mut map = watches.0.lock().unwrap();
    if map.contains_key(root) {
        return Ok(());
    }
    let handle = app.clone();
    let top = root.to_string();
    let mut debouncer = new_debouncer(Duration::from_millis(150), move |res: DebounceEventResult| {
        let paths: Vec<String> = match res {
            Ok(DebouncedEventBatch::Events(events)) => events
                .into_iter()
                .map(|e| e.path)
                .filter(|p| !ignored(p))
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            // Rescan (FSEvents dropped some), or a kind added later (the enum is
            // non_exhaustive): the root stands for "anything in it may have changed".
            Ok(_) => vec![top.clone()],
            Err(_) => return,
        };
        if !paths.is_empty() {
            let _ = handle.emit("fs-changed", paths);
        }
    })
    .map_err(err)?;
    debouncer.watcher().watch(Path::new(root), RecursiveMode::Recursive).map_err(err)?;
    map.insert(root.to_string(), debouncer);
    Ok(())
}

/// Stops watching a project: its debouncer goes, and with it the FSEvents watch.
pub fn unwatch(app: &AppHandle, root: &str) {
    app.state::<Watches>().0.lock().unwrap().remove(root);
}

#[cfg(test)]
mod tests {
    use super::ignored;
    use std::path::Path;

    #[test]
    fn keeps_what_the_ui_shows() {
        for p in ["/r/src/main.rs", "/r/.git/HEAD", "/r/.git/index", "/r/.git/refs/heads/main", "/r/.github/ci.yml"] {
            assert!(!ignored(Path::new(p)), "{p}");
        }
    }

    #[test]
    fn drops_noise() {
        for p in ["/r/.git/objects/ab/cd", "/r/.git/logs/HEAD", "/r/.git/index.lock", "/r/a/__pycache__/x.pyc", "/r/.venv/bin/python", "/r/node_modules/x"] {
            assert!(ignored(Path::new(p)), "{p}");
        }
    }
}
