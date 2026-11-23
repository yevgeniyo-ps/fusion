// Import from a GitHub org: list its repos, then check out the chosen ones into a folder and
// add them as projects. Both go through the GitHub CLI (`gh`), with the user's own login: it
// sees their private and internal repos, and `gh repo clone` uses their protocol (https or
// ssh) and credentials.
//
// A repo already checked out in the folder is not cloned again: it only becomes a project,
// if it is not one yet. A folder of that name that is not a git checkout is left alone.

use crate::projects::{add, err, expand, Project, Projects};
use serde::Serialize;
use std::collections::VecDeque;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// Clones at the same time: enough to be quick, few enough not to flood the network.
const WORKERS: usize = 4;

#[derive(Serialize)]
pub struct GhRepo {
    name: String,
    full_name: String,
    description: String,
    /// "public", "private" or "internal".
    visibility: String,
    archived: bool,
    pushed_at: String,
    /// The folder already has a checkout of this name.
    exists: bool,
    /// It is a Fusion project already.
    project: bool,
}

#[derive(Serialize)]
pub struct GhListing {
    owner: String,
    repos: Vec<GhRepo>,
}

/// The owner in what the user pasted: "https://github.com/acme", "github.com/acme/",
/// "git@github.com:acme", "acme/some-repo" or "acme".
fn owner_of(input: &str) -> Option<String> {
    let s = input.trim().trim_end_matches('/').trim_end_matches(".git");
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let s = s.strip_prefix("git@github.com:").or_else(|| s.strip_prefix("github.com/")).or_else(|| s.strip_prefix("www.github.com/")).unwrap_or(s);
    let owner = s.split('/').next()?.trim();
    let ok = !owner.is_empty() && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    ok.then(|| owner.to_string())
}

fn gh(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("gh").args(args).stdin(Stdio::null()).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "The GitHub CLI is not installed. Install it (brew install gh) and run gh auth login.".to_string()
        } else {
            err(e)
        }
    })
}

/// Name, full name, description, visibility, archived, last push: one JSON array per line.
/// Each field has a default: an empty repo has no push yet, and a null would drop the line.
const FIELDS: &str = r#".[] | [.name, .full_name, (.description // ""), (.visibility // ""), (.archived // false), (.pushed_at // "")] | @json"#;

#[tauri::command]
pub async fn github_repos(projects: State<'_, Projects>, input: String, parent: String) -> Result<GhListing, String> {
    let owner = owner_of(&input).ok_or_else(|| format!("Not a GitHub org or user: {input:?}"))?;
    let known: Vec<String> = projects.paths();
    let folder = expand(&parent);
    tauri::async_runtime::spawn_blocking(move || {
        // An org; else a user: the signed-in user's own repos include the private ones.
        let mut out = gh(&["api", "--paginate", &format!("orgs/{owner}/repos?per_page=100&type=all"), "--jq", FIELDS])?;
        if !out.status.success() {
            let me = gh(&["api", "user", "--jq", ".login"])?;
            let me = String::from_utf8_lossy(&me.stdout).trim().to_string();
            let path = if me.eq_ignore_ascii_case(&owner) { "user/repos?per_page=100&affiliation=owner".to_string() } else { format!("users/{owner}/repos?per_page=100") };
            out = gh(&["api", "--paginate", &path, "--jq", FIELDS])?;
        }
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if msg.contains("auth login") { "Not signed in to GitHub: run gh auth login.".into() } else if msg.is_empty() { format!("No repos found for {owner}") } else { msg });
        }
        let mut repos: Vec<GhRepo> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| serde_json::from_str::<(String, String, String, String, bool, String)>(l).ok())
            .map(|(name, full_name, description, visibility, archived, pushed_at)| {
                let dest = folder.join(&name);
                let exists = dest.join(".git").exists();
                let canon = std::fs::canonicalize(&dest).ok().map(|p| p.to_string_lossy().into_owned());
                let project = canon.is_some_and(|c| known.contains(&c));
                GhRepo { name, full_name, description, visibility, archived, pushed_at, exists, project }
            })
            .collect();
        // The most recently pushed first, as GitHub's own list.
        repos.sort_by(|a, b| b.pushed_at.cmp(&a.pushed_at));
        Ok(GhListing { owner, repos })
    })
    .await
    .map_err(err)?
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ImportEvent {
    /// A line of git's progress for one repo.
    Progress { name: String, line: String },
    /// Checked out (or found checked out already) and a project now.
    Done { name: String, cloned: bool, project: Project },
    Failed { name: String, error: String },
}

/// `gh repo clone <full name> <dest>`, with git's progress lines sent as they come. It never
/// waits for a password: a repo that needs one fails with git's message.
fn clone(full: &str, name: &str, dest: &Path, events: &Channel<ImportEvent>) -> Result<(), String> {
    let mut cmd = Command::new("gh");
    cmd.args(["repo", "clone", full]).arg(dest).args(["--", "--progress"]);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15");
    }
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(err)?;
    let mut stderr = child.stderr.take().unwrap();
    let (mut buf, mut line, mut last) = ([0u8; 4096], String::new(), String::new());
    while let Ok(n) = stderr.read(&mut buf) {
        if n == 0 {
            break;
        }
        for ch in String::from_utf8_lossy(&buf[..n]).chars() {
            if ch == '\r' || ch == '\n' {
                if !line.trim().is_empty() {
                    let _ = events.send(ImportEvent::Progress { name: name.into(), line: line.clone() });
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
        Err(if last.is_empty() { "clone failed".into() } else { last })
    }
}

/// Checks out each repo (full names, "org/name") into `parent` and makes it a project. The
/// events report each repo as it goes; the call returns when all are done.
#[tauri::command]
pub async fn github_import(app: AppHandle, parent: String, repos: Vec<String>, on_event: Channel<ImportEvent>) -> Result<(), String> {
    let folder = expand(&parent);
    std::fs::create_dir_all(&folder).map_err(err)?;
    let queue = Arc::new(Mutex::new(repos.into_iter().collect::<VecDeque<String>>()));
    let workers: Vec<_> = (0..WORKERS)
        .map(|_| {
            let (queue, folder, app, events) = (queue.clone(), folder.clone(), app.clone(), on_event.clone());
            thread::spawn(move || loop {
                let Some(full) = queue.lock().unwrap().pop_front() else { break };
                let name = full.rsplit('/').next().unwrap_or(&full).to_string();
                // A name from GitHub is one folder name: never a path.
                if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\']) {
                    let _ = events.send(ImportEvent::Failed { name, error: "not a repo name".into() });
                    continue;
                }
                let dest = folder.join(&name);
                let cloned = if dest.join(".git").exists() {
                    false
                } else if dest.exists() {
                    let _ = events.send(ImportEvent::Failed { name, error: format!("{} exists and is not a git checkout", dest.display()) });
                    continue;
                } else if let Err(e) = clone(&full, &name, &dest, &events) {
                    let _ = events.send(ImportEvent::Failed { name, error: e });
                    continue;
                } else {
                    true
                };
                let projects = app.state::<Projects>();
                match add(&app, &projects, &dest) {
                    Ok(project) => drop(events.send(ImportEvent::Done { name, cloned, project })),
                    Err(e) => drop(events.send(ImportEvent::Failed { name, error: e })),
                }
            })
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || workers.into_iter().for_each(|w| drop(w.join())))
        .await
        .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::owner_of;

    #[test]
    fn owners() {
        for s in ["https://github.com/acme", "github.com/acme/", "git@github.com:acme", "acme/shop", "acme", " https://github.com/acme/shop.git "] {
            assert_eq!(owner_of(s).as_deref(), Some("acme"), "{s}");
        }
        assert_eq!(owner_of("not an org!"), None);
        assert_eq!(owner_of(""), None);
    }
}
