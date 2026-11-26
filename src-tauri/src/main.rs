// Fusion: one tab mixes several repos. The tab's terminal, and the Claude session in it,
// see only those repos.

mod atlantis;
mod fsx;
mod git;
mod github;
mod projects;
mod session;
mod plan;
mod pty;
mod search;
mod shot;
mod tab;
mod tray;
mod watch;

/// An app opened from the Dock or the Finder gets launchd's PATH (/usr/bin:/bin:…), not the
/// user's: git would not find its credential helpers (gh in /opt/homebrew/bin) or hooks.
/// So the PATH comes from the user's login shell, once, before anything runs git.
/// The shell's own output (a prompt, a greeting) is around the markers and is dropped.
fn login_path() {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    const MARK: &str = "__FUSION_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let Ok(mut child) = Command::new(&shell)
        .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    // A shell whose startup files wait for something must not hold the app.
    let deadline = Instant::now() + Duration::from_secs(3);
    while child.try_wait().ok().flatten().is_none() {
        if Instant::now() > deadline {
            let _ = child.kill();
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut out = String::new();
    let _ = child.stdout.take().map(|mut s| s.read_to_string(&mut out));
    if let Some(path) = out.split(MARK).nth(1).filter(|p| p.contains('/')) {
        std::env::set_var("PATH", path);
    }
}

/// A Fusion started from inside a Claude Code session (its terminal ran `open Fusion.app`)
/// inherits that session's variables: a claude in Fusion's terminals would then run as its
/// child (no transcript of its own), and the session's messaging token
/// would be visible there. They go, once, before anything starts; the user's own
/// CLAUDE_CONFIG_DIR stays.
fn drop_parent_claude_env() {
    for (key, _) in std::env::vars_os() {
        let Some(k) = key.to_str() else { continue };
        if k == "CLAUDECODE" || k.starts_with("CLAUDE_CODE_") || k == "CLAUDE_PID" || k == "CLAUDE_EFFORT" {
            std::env::remove_var(&key);
        }
    }
}

fn main() {
    login_path();
    drop_parent_claude_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| Ok(tray::install(app.handle())?))
        .manage(projects::Projects::default())
        .manage(pty::Ptys::default())
        .manage(watch::Watches::default())
        .invoke_handler(tauri::generate_handler![
            atlantis::atlantis_state,
            atlantis::atlantis_run,
            atlantis::atlantis_merge,
            plan::plan_usage,
            projects::projects_load,
            projects::project_add,
            projects::project_remove,
            projects::project_clone,
            projects::layout_load,
            projects::layout_save,
            fsx::read_dir,
            fsx::read_file,
            fsx::write_file,
            git::git_status,
            git::git_head_file,
            git::git_fetch,
            git::git_branches,
            git::git_switch,
            git::git_publish,
            git::git_pull,
            git::github_url,
            git::open_url,
            github::github_repos,
            github::github_import,
            tab::tab_sync,
            tab::tab_close,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_states,
            shot::screenshot,
            search::search,
        ])
        .run(tauri::generate_context!())
        .expect("Fusion failed to start");
}
