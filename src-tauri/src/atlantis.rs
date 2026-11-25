// Atlantis from a project pane: the pull request of the checkout's branch, the Atlantis
// projects it changes, and the Atlantis conversation on it. A command is a PR comment
// (`atlantis plan`, `atlantis apply -p <name>`, `atlantis unlock`), posted with the GitHub
// CLI as the user, exactly as typing it on GitHub; Atlantis answers with comments.

use crate::projects::err;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Serialize)]
pub struct AtlantisProject {
    name: String,
    /// The project's folder, relative to the repo, without a leading "/".
    dir: String,
}

#[derive(Serialize)]
pub struct AtlantisPr {
    number: u64,
    url: String,
    title: String,
    state: String,
    head: String,
    draft: bool,
    base: String,
    /// GitHub's view: MERGEABLE, CONFLICTING or UNKNOWN.
    mergeable: String,
    /// CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, HAS_HOOKS or UNKNOWN.
    merge_state: String,
    /// APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or "".
    review: String,
}

#[derive(Serialize)]
pub struct AtlantisComment {
    author: String,
    body: String,
    created_at: String,
    url: String,
    /// Written by Atlantis (else: a command someone typed).
    bot: bool,
}

#[derive(Serialize)]
pub struct AtlantisState {
    projects: Vec<AtlantisProject>,
    /// Names of the projects whose folder has a changed file in the PR.
    changed: Vec<String>,
    pr: Option<AtlantisPr>,
    comments: Vec<AtlantisComment>,
}

/// The `name:` / `dir:` pairs of atlantis.yaml's projects. A line-by-line read, enough for
/// the usual layout (each project a list item with name and dir).
fn parse_projects(yaml: &str) -> Vec<AtlantisProject> {
    let mut out: Vec<AtlantisProject> = Vec::new();
    let (mut name, mut dir): (Option<String>, Option<String>) = (None, None);
    let flush = |name: &mut Option<String>, dir: &mut Option<String>, out: &mut Vec<AtlantisProject>| {
        if let Some(d) = dir.take() {
            let d = d.trim_start_matches("./").trim_start_matches('/').trim_end_matches('/').to_string();
            out.push(AtlantisProject { name: name.take().unwrap_or_else(|| d.clone()), dir: d });
        }
        *name = None;
    };
    for raw in yaml.lines() {
        let line = raw.split(" #").next().unwrap_or("").trim_end();
        let t = line.trim_start();
        if t.starts_with('#') || t.is_empty() {
            continue;
        }
        let item = t.strip_prefix("- ");
        if item.is_some() {
            flush(&mut name, &mut dir, &mut out);
        }
        let kv = item.unwrap_or(t);
        let value = |k: &str| kv.strip_prefix(k).map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string());
        if let Some(v) = value("name:") {
            name = Some(v);
        } else if let Some(v) = value("dir:") {
            dir = Some(v);
        }
    }
    flush(&mut name, &mut dir, &mut out);
    out
}

fn gh(dir: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("gh").args(args).current_dir(dir).stdin(Stdio::null()).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "The GitHub CLI is not installed. Install it (brew install gh) and run gh auth login.".to_string()
        } else {
            err(e)
        }
    })
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

#[tauri::command]
pub async fn atlantis_state(path: String) -> Result<AtlantisState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&path);
        let yaml = std::fs::read_to_string(root.join("atlantis.yaml")).map_err(|_| "No atlantis.yaml in this project.".to_string())?;
        let projects = parse_projects(&yaml);

        // The PR of the checked-out branch. None: no PR yet (gh says so on stderr).
        let out = gh(root, &["pr", "view", "--json", "number,url,title,state,headRefOid,files,comments,isDraft,baseRefName,mergeable,mergeStateStatus,reviewDecision"])?;
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if msg.contains("no pull requests found") || msg.contains("no open pull requests") {
                return Ok(AtlantisState { projects, changed: vec![], pr: None, comments: vec![] });
            }
            return Err(if msg.is_empty() { "gh pr view failed".into() } else { msg });
        }
        let v: Value = serde_json::from_slice(&out.stdout).map_err(err)?;
        let files: Vec<String> = v["files"].as_array().into_iter().flatten().map(|f| s(f, "path")).collect();
        let changed = projects
            .iter()
            // A file in the project's folder or under it (autoplan's usual "**/*.tf*").
            .filter(|p| files.iter().any(|f| Path::new(f).starts_with(&p.dir)))
            .map(|p| p.name.clone())
            .collect();
        // The Atlantis conversation: its answers, and the commands that started them.
        let comments = v["comments"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|c| {
                let author = c["author"]["login"].as_str().unwrap_or("").to_string();
                let body = s(c, "body");
                let bot = author.to_ascii_lowercase().contains("atlantis");
                let command = body.trim_start().starts_with("atlantis ");
                (bot || command).then(|| AtlantisComment { author, body, created_at: s(c, "createdAt"), url: s(c, "url"), bot })
            })
            .collect();
        let pr = AtlantisPr {
            number: v["number"].as_u64().unwrap_or(0),
            url: s(&v, "url"),
            title: s(&v, "title"),
            state: s(&v, "state"),
            head: s(&v, "headRefOid"),
            draft: v["isDraft"].as_bool().unwrap_or(false),
            base: s(&v, "baseRefName"),
            mergeable: s(&v, "mergeable"),
            merge_state: s(&v, "mergeStateStatus"),
            review: s(&v, "reviewDecision"),
        };
        Ok(AtlantisState { projects, changed, pr: Some(pr), comments })
    })
    .await
    .map_err(err)?
}

/// Only Atlantis's own commands, with an optional `-p <project>`: nothing else is posted.
fn valid(command: &str) -> bool {
    let re = regex::Regex::new(r"^atlantis (plan|apply|unlock)( -p [A-Za-z0-9._/-]+)?$").unwrap();
    re.is_match(command)
}

#[tauri::command]
pub async fn atlantis_run(path: String, number: u64, command: String) -> Result<(), String> {
    if !valid(&command) {
        return Err(format!("Not an Atlantis command: {command:?}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let n = number.to_string();
        let out = gh(Path::new(&path), &["pr", "comment", &n, "--body", &command])?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(err)?
}

/// Merges the PR as GitHub's button does: squash, merge commit or rebase. `admin` is
/// "Merge without waiting for requirements to be met (bypass rules)" (gh pr merge --admin).
#[tauri::command]
pub async fn atlantis_merge(path: String, number: u64, method: String, admin: bool) -> Result<(), String> {
    let flag = match method.as_str() {
        "squash" => "--squash",
        "merge" => "--merge",
        "rebase" => "--rebase",
        _ => return Err(format!("Unknown merge method: {method}")),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let n = number.to_string();
        let mut args = vec!["pr", "merge", n.as_str(), flag];
        if admin {
            args.push("--admin");
        }
        let out = gh(Path::new(&path), &args)?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_projects() {
        let y = "version: 3\nprojects:\n# - name: off\n#   dir: /x\n- name: prod/aws/vpn # VPN\n  dir: /live/prod/aws/vpn\n- dir: live/other/\n  autoplan:\n    enabled: true\n";
        let p = parse_projects(y);
        assert_eq!(p.len(), 2);
        assert_eq!((p[0].name.as_str(), p[0].dir.as_str()), ("prod/aws/vpn", "live/prod/aws/vpn"));
        assert_eq!((p[1].name.as_str(), p[1].dir.as_str()), ("live/other", "live/other"));
    }

    #[test]
    fn only_atlantis_commands() {
        assert!(valid("atlantis plan"));
        assert!(valid("atlantis apply -p prod/aws/mgmt/eu-north-1"));
        assert!(valid("atlantis unlock"));
        assert!(!valid("atlantis apply; rm -rf /"));
        assert!(!valid("atlantis plan -- -destroy"));
        assert!(!valid("lgtm"));
    }
}
