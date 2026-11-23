// The folder behind each tab: the terminal starts there, and so does Claude.
//
//   <app data>/tabs/<id>/
//     CLAUDE.md        which projects the tab mixes (generated)
//     <name> -> path   a symlink per project, for `cd api`
//     .fusion/
//       dirs           one project path per line: the wrapper's --add-dir list
//       session        the tab's Claude session id
//       bin/claude     the wrapper (resources/claude.sh), first on the shell's PATH
//       zdotdir/       zsh startup files that put bin/ first, after the user's own
//       claude.pid     while the wrapper runs; restart: set while Fusion restarts it

use crate::projects::{data_dir, err};
use crate::pty::Ptys;
use serde::Deserialize;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

const WRAPPER: &str = include_str!("../resources/claude.sh");

// Each file runs the user's own file of the same name first. Then bin/ goes first on PATH:
// after .zshrc for interactive shells, and again after .zlogin, which a login shell reads last.
const ZSHENV: &str = r#"[ -f "$FUSION_USER_ZDOTDIR/.zshenv" ] && . "$FUSION_USER_ZDOTDIR/.zshenv"
"#;
const ZPROFILE: &str = r#"[ -f "$FUSION_USER_ZDOTDIR/.zprofile" ] && . "$FUSION_USER_ZDOTDIR/.zprofile"
"#;
const ZSHRC: &str = r#"[ -f "$FUSION_USER_ZDOTDIR/.zshrc" ] && . "$FUSION_USER_ZDOTDIR/.zshrc"
path=("$FUSION_TAB_DIR/.fusion/bin" ${path:#$FUSION_TAB_DIR/.fusion/bin})
"#;
const ZLOGIN: &str = r#"[ -f "$FUSION_USER_ZDOTDIR/.zlogin" ] && . "$FUSION_USER_ZDOTDIR/.zlogin"
path=("$FUSION_TAB_DIR/.fusion/bin" ${path:#$FUSION_TAB_DIR/.fusion/bin})
"#;

pub fn tab_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    // The id names a folder: only the characters of a UUID.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("bad tab id {id:?}"));
    }
    Ok(data_dir(app)?.join("tabs").join(id))
}

#[derive(Deserialize)]
pub struct TabProject {
    name: String,
    path: String,
}

fn write_exec(path: &Path, text: &str) -> Result<(), String> {
    fs::write(path, text).map_err(err)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(err)
}

/// A file-name-safe name for each project's symlink, unique in the tab.
fn link_names(projects: &[TabProject]) -> Vec<String> {
    let mut used: Vec<String> = vec!["CLAUDE.md".into()];
    projects
        .iter()
        .map(|p| {
            let base: String = p.name.chars().map(|c| if c == '/' || c.is_control() { '-' } else { c }).collect();
            let base = if base.is_empty() || base.starts_with('.') { format!("project{base}") } else { base };
            let mut name = base.clone();
            let mut n = 2;
            while used.contains(&name) {
                name = format!("{base}-{n}");
                n += 1;
            }
            used.push(name.clone());
            name
        })
        .collect()
}

fn claude_md(name: &str, projects: &[TabProject], links: &[String]) -> String {
    let mut s = format!(
        "<!-- Fusion writes this file each time the tab changes. Edits here are lost. -->\n\
         # {name}\n\n\
         This folder is a Fusion tab. The tab mixes these projects:\n\n"
    );
    for (p, link) in projects.iter().zip(links) {
        s += &format!("- **{}**: `{}` (symlink `./{link}`)\n", p.name, p.path);
    }
    if projects.is_empty() {
        s += "- (none yet)\n";
    }
    s += "\nWork only in these projects. When the user adds or removes a project, \
          Fusion restarts this session with the new set of directories.\n";
    s
}

/// Brings the tab folder up to date with the tab's projects. When the set of projects
/// changed and the tab's Claude is running, it restarts with the new set. Returns the folder.
#[tauri::command]
pub fn tab_sync(app: AppHandle, id: String, name: String, projects: Vec<TabProject>) -> Result<String, String> {
    let dir = tab_dir(&app, &id)?;
    let meta = dir.join(".fusion");
    fs::create_dir_all(meta.join("bin")).map_err(err)?;
    fs::create_dir_all(meta.join("zdotdir")).map_err(err)?;

    let session = meta.join("session");
    if !session.exists() {
        fs::write(&session, uuid::Uuid::new_v4().to_string()).map_err(err)?;
    }
    write_exec(&meta.join("bin/claude"), WRAPPER)?;
    for (file, text) in [(".zshenv", ZSHENV), (".zprofile", ZPROFILE), (".zshrc", ZSHRC), (".zlogin", ZLOGIN)] {
        fs::write(meta.join("zdotdir").join(file), text).map_err(err)?;
    }

    // Symlinks: only the ones Fusion made (a symlink at the top level) are removed.
    for e in fs::read_dir(&dir).map_err(err)?.flatten() {
        if e.file_type().map(|t| t.is_symlink()).unwrap_or(false) {
            let _ = fs::remove_file(e.path());
        }
    }
    let links = link_names(&projects);
    for (p, link) in projects.iter().zip(&links) {
        let _ = symlink(&p.path, dir.join(link));
    }
    fs::write(dir.join("CLAUDE.md"), claude_md(&name, &projects, &links)).map_err(err)?;

    let dirs: String = projects.iter().map(|p| format!("{}\n", p.path)).collect();
    let dirs_file = meta.join("dirs");
    let old = fs::read_to_string(&dirs_file).ok();
    if old.as_deref() != Some(dirs.as_str()) {
        fs::write(&dirs_file, &dirs).map_err(err)?;
        if old.is_some() {
            restart_claude(&meta);
        }
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Stops the tab's claude; the wrapper sees .fusion/restart and starts it again with --resume.
fn restart_claude(meta: &Path) {
    let Ok(pid) = fs::read_to_string(meta.join("claude.pid")) else { return };
    let pid = pid.trim();
    if pid.is_empty() || !pid.chars().all(|c| c.is_ascii_digit()) {
        return;
    }
    if fs::write(meta.join("restart"), "").is_ok() {
        // The wrapper's only child is claude.
        let _ = Command::new("/usr/bin/pkill").args(["-TERM", "-P", pid]).status();
    }
}

#[tauri::command]
pub fn tab_close(app: AppHandle, ptys: State<Ptys>, id: String) -> Result<(), String> {
    ptys.kill(&id);
    let dir = tab_dir(&app, &id)?;
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(err)?;
    }
    Ok(())
}
