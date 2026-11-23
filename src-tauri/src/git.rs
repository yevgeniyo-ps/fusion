// Branch, state and changed files for a pane, and a file's HEAD version for the diff.

use crate::projects::{err, Projects};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::process::Command;
use tauri::State;

#[derive(Serialize, Default)]
pub struct GitStatus {
    repo: bool,
    branch: String,
    /// The HEAD commit: when it moves, the diff's base changes.
    head: String,
    /// Changed and untracked files.
    dirty: u32,
    ahead: u32,
    behind: u32,
    /// Absolute path and one letter: M changed, A added, D deleted, U untracked, R renamed.
    /// An untracked folder is one entry, its path ending in "/".
    files: Vec<(String, char)>,
}

/// A read-only git call. No optional locks: else `git status` refreshes .git/index, the
/// watcher sees the write, the UI asks for the status again, and that loops without end.
fn git(dir: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git").arg("-C").arg(dir).args(args).env("GIT_OPTIONAL_LOCKS", "0").output().map_err(err)
}

/// Each project's repo root, found once: a repo does not move under its project. Only a found
/// root is kept, so a folder that becomes a repo later is seen then.
fn root_of(p: &Path) -> Result<Option<String>, String> {
    static ROOTS: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();
    let roots = ROOTS.get_or_init(Default::default);
    if let Some(r) = roots.lock().unwrap().get(p) {
        return Ok(Some(r.clone()));
    }
    let top = git(p, &["rev-parse", "--show-toplevel"])?;
    if !top.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8_lossy(&top.stdout).trim().to_string();
    roots.lock().unwrap().insert(p.to_path_buf(), root.clone());
    Ok(Some(root))
}

/// One git call per status (porcelain v2 has the HEAD commit too): it runs on each change on
/// disk, for each project of the open tab.
#[tauri::command]
pub async fn git_status(projects: State<'_, Projects>, path: String) -> Result<GitStatus, String> {
    let p = projects.guard(&path)?;
    // Status paths are relative to the repo root, which can be above the project folder.
    let Some(root) = root_of(&p)? else { return Ok(GitStatus::default()) };
    // -uall: each new file, not its new folder, so every entry opens in the editor.
    let out = git(&p, &["status", "--porcelain=v2", "--branch", "-z", "-uall"])?;
    if !out.status.success() {
        return Ok(GitStatus::default());
    }
    Ok(parse_status(&String::from_utf8_lossy(&out.stdout), &root))
}

/// `git status --porcelain=v2 --branch -z` to a GitStatus, with absolute paths under `root`.
fn parse_status(text: &str, root: &str) -> GitStatus {
    let mut st = GitStatus { repo: true, ..Default::default() };
    let mut entries = text.split('\0').filter(|e| !e.is_empty());
    while let Some(e) = entries.next() {
        let (kind, rest) = e.split_once(' ').unwrap_or((e, ""));
        let (xy, file) = match kind {
            "#" => {
                let (key, value) = rest.split_once(' ').unwrap_or((rest, ""));
                match key {
                    "branch.oid" if value != "(initial)" => st.head = value.into(),
                    "branch.head" => st.branch = if value == "(detached)" { "detached".into() } else { value.into() },
                    "branch.ab" => {
                        for n in value.split(' ') {
                            if let Some(a) = n.strip_prefix('+') {
                                st.ahead = a.parse().unwrap_or(0);
                            } else if let Some(b) = n.strip_prefix('-') {
                                st.behind = b.parse().unwrap_or(0);
                            }
                        }
                    }
                    _ => {}
                }
                continue;
            }
            // "1 XY sub mH mI mW hH hI path"
            "1" => match rest.splitn(8, ' ').collect::<Vec<_>>()[..] {
                [xy, .., file] => (xy, file),
                _ => continue,
            },
            // "2 XY sub mH mI mW hH hI score path", then the old path as its own entry.
            "2" => {
                entries.next();
                match rest.splitn(9, ' ').collect::<Vec<_>>()[..] {
                    [xy, .., file] => (xy, file),
                    _ => continue,
                }
            }
            // "u XY sub m1 m2 m3 mW h1 h2 h3 path": a merge conflict.
            "u" => match rest.splitn(10, ' ').collect::<Vec<_>>()[..] {
                [xy, .., file] => (xy, file),
                _ => continue,
            },
            "?" => ("??", rest),
            _ => continue,
        };
        st.files.push((format!("{root}/{file}"), code(xy)));
    }
    st.dirty = st.files.len() as u32;
    st
}

/// "XY" from git status to one letter, the worktree's view first.
fn code(xy: &str) -> char {
    match xy {
        "??" => 'U',
        _ if xy.contains('D') => 'D',
        _ if xy.contains('R') || xy.contains('C') => 'R',
        _ if xy.contains('A') => 'A',
        _ => 'M',
    }
}

#[derive(Serialize)]
pub struct Branch {
    name: String,
    /// The branch it tracks (origin/main), or "".
    upstream: String,
    /// When its last commit was made: "2 days ago".
    when: String,
}

#[derive(Serialize)]
pub struct Branches {
    current: String,
    local: Vec<Branch>,
    /// Remote branches with no local branch of the same name.
    remote: Vec<Branch>,
}

/// The project's branches, the most recently committed first.
#[tauri::command]
pub async fn git_branches(projects: State<'_, Projects>, path: String) -> Result<Branches, String> {
    let p = projects.guard(&path)?;
    let current = git(&p, &["branch", "--show-current"])?;
    let current = String::from_utf8_lossy(&current.stdout).trim().to_string();
    let out = git(
        &p,
        &["for-each-ref", "--sort=-committerdate", "--format=%(refname)%09%(upstream:short)%09%(committerdate:relative)", "refs/heads", "refs/remotes"],
    )?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let mut f = line.splitn(3, '\t');
        let (Some(r), Some(up), Some(when)) = (f.next(), f.next(), f.next()) else { continue };
        let b = |name: &str| Branch { name: name.to_string(), upstream: up.to_string(), when: when.to_string() };
        if let Some(name) = r.strip_prefix("refs/heads/") {
            local.push(b(name));
        } else if let Some(name) = r.strip_prefix("refs/remotes/") {
            // origin/HEAD is a pointer, not a branch.
            if !name.ends_with("/HEAD") {
                remote.push(b(name));
            }
        }
    }
    // A remote branch that has a local one is not listed twice.
    remote.retain(|r| {
        let short = r.name.split_once('/').map_or(r.name.as_str(), |(_, b)| b);
        !local.iter().any(|l| l.name == short || l.upstream == r.name)
    });
    Ok(Branches { current, local, remote })
}

/// Switches the project to `branch`. With `create`, a new branch from the current commit;
/// with a remote branch (origin/x), a local branch that tracks it. Git's own error comes back
/// when it refuses (uncommitted changes the switch would overwrite): nothing is forced.
#[tauri::command]
pub async fn git_switch(projects: State<'_, Projects>, path: String, branch: String, create: bool, remote: bool) -> Result<(), String> {
    let p = projects.guard(&path)?;
    let name = branch.trim();
    // A name that starts with "-" would be read as an option.
    if name.is_empty() || name.starts_with('-') || name.contains(char::is_whitespace) {
        return Err(format!("Not a branch name: {name:?}"));
    }
    let args: Vec<&str> = if create {
        vec!["switch", "-c", name]
    } else if remote {
        vec!["switch", "--track", name]
    } else {
        vec!["switch", name]
    };
    let out = Command::new("git")
        .arg("-C")
        .arg(&p)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(err)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[derive(Serialize)]
pub struct Pulled {
    ok: bool,
    /// One line for the result: "Already up to date.", "2 files changed, …", or git's error.
    summary: String,
}

/// `git pull --ff-only`, out of sight (the terminal is busy): it only moves the branch
/// forward, never merges or rebases, so it can leave no conflict behind. Like the background
/// fetch, it never waits for a password.
#[tauri::command]
pub async fn git_pull(projects: State<'_, Projects>, path: String) -> Result<Pulled, String> {
    let p = projects.guard(&path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Pulled, String> {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&p).args(["pull", "--ff-only"]);
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        if std::env::var_os("GIT_SSH_COMMAND").is_none() {
            cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15");
        }
        let out = cmd.stdin(std::process::Stdio::null()).output().map_err(err)?;
        let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        let summary = if out.status.success() {
            lines
                .iter()
                .find(|l| l.contains("file changed") || l.contains("files changed") || l.starts_with("Already up to date"))
                .map(|l| l.to_string())
                .unwrap_or_else(|| "pulled".into())
        } else if text.contains("Not possible to fast-forward") || text.contains("diverged") {
            "can't fast-forward: pull in the terminal to merge".into()
        } else {
            lines.iter().rev().find(|l| l.starts_with("fatal:") || l.starts_with("error:")).or(lines.last()).map(|l| l.to_string()).unwrap_or_else(|| "pull failed".into())
        };
        Ok(Pulled { ok: out.status.success(), summary })
    })
    .await
    .map_err(err)?
}

/// Pushes the current branch to its remote and tracks it there (`git push -u <remote> <branch>`):
/// a new branch, published. Like the background fetch, it never waits for a password.
#[tauri::command]
pub async fn git_publish(projects: State<'_, Projects>, path: String) -> Result<(), String> {
    let p = projects.guard(&path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let branch = git(&p, &["branch", "--show-current"])?;
        let branch = String::from_utf8_lossy(&branch.stdout).trim().to_string();
        if branch.is_empty() {
            return Err("Not on a branch.".into());
        }
        let remotes = git(&p, &["remote"])?;
        let remotes = String::from_utf8_lossy(&remotes.stdout).to_string();
        let remote = if remotes.lines().any(|r| r == "origin") { "origin" } else { remotes.lines().next().ok_or("This repo has no remote.")? };
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&p).args(["push", "-u", remote, &branch]);
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        if std::env::var_os("GIT_SSH_COMMAND").is_none() {
            cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=10");
        }
        let out = cmd.stdin(std::process::Stdio::null()).output().map_err(err)?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(err)?
}

/// `git fetch` in the background, so the behind count (↓) is true: it downloads, it does not
/// change the working tree. It must never wait for a person: no credential prompt, ssh in
/// batch mode, and it gives up after FETCH_TIMEOUT. False when it did not finish.
#[tauri::command]
pub async fn git_fetch(projects: State<'_, Projects>, path: String) -> Result<bool, String> {
    let p = projects.guard(&path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&p).args(["fetch", "--quiet", "--no-write-fetch-head"]);
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        // The user's own GIT_SSH_COMMAND (an agent, a proxy) stays.
        if std::env::var_os("GIT_SSH_COMMAND").is_none() {
            cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=10");
        }
        let mut child = cmd
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(err)?;
        let deadline = std::time::Instant::now() + FETCH_TIMEOUT;
        loop {
            if let Some(status) = child.try_wait().map_err(err)? {
                return Ok(status.success());
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(false);
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    })
    .await
    .map_err(err)?
}

const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The file as HEAD has it; None for a file HEAD does not have (new or untracked).
#[tauri::command]
pub async fn git_head_file(projects: State<'_, Projects>, path: String) -> Result<Option<String>, String> {
    let p = projects.guard(&path)?;
    let (Some(dir), Some(name)) = (p.parent(), p.file_name()) else { return Ok(None) };
    // "HEAD:./name" is relative to -C dir.
    let spec = format!("HEAD:./{}", name.to_string_lossy());
    let out = git(dir, &["show", &spec])?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(String::from_utf8(out.stdout).ok())
}

/// The file's page on GitHub, at lines `from`..`to` (1-based) when given. The ref is the
/// branch when it is pushed (it has an upstream), else the HEAD commit: a link must not
/// name a branch the remote does not have.
#[tauri::command]
pub async fn github_url(
    projects: State<'_, Projects>,
    path: String,
    from: Option<u32>,
    to: Option<u32>,
) -> Result<String, String> {
    let p = projects.guard(&path)?;
    let dir = p.parent().ok_or("no folder")?;
    let out = |args: &[&str]| -> Result<Option<String>, String> {
        let o = git(dir, args)?;
        Ok(o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string()))
    };
    let root = out(&["rev-parse", "--show-toplevel"])?.ok_or("This file is not in a git repo.")?;
    let remote = match out(&["config", "--get", "remote.origin.url"])? {
        Some(url) => url,
        // No "origin": the first remote there is.
        None => {
            let name = out(&["remote"])?.and_then(|r| r.lines().next().map(String::from)).ok_or("This repo has no remote.")?;
            out(&["remote", "get-url", &name])?.ok_or("This repo has no remote.")?
        }
    };
    let web = web_url(&remote).ok_or_else(|| format!("Not a web remote: {remote}"))?;
    let pushed = out(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?.is_some();
    let branch = out(&["rev-parse", "--abbrev-ref", "HEAD"])?.filter(|b| b != "HEAD");
    let reference = match (pushed, branch) {
        (true, Some(b)) => b,
        _ => out(&["rev-parse", "HEAD"])?.ok_or("This repo has no commits yet.")?,
    };
    let rel = p.strip_prefix(&root).map_err(err)?.to_string_lossy().into_owned();
    let mut url = format!("{web}/blob/{}/{}", encode(&reference), encode(&rel));
    match (from, to) {
        (Some(a), Some(b)) if b > a => url += &format!("#L{a}-L{b}"),
        (Some(a), _) => url += &format!("#L{a}"),
        _ => {}
    }
    Ok(url)
}

/// The repo's https page from its remote URL:
/// git@github.com:org/repo.git, ssh://git@host:22/org/repo.git, https://user@host/org/repo.git.
fn web_url(remote: &str) -> Option<String> {
    let r = remote.trim().trim_end_matches('/').trim_end_matches(".git");
    let (host, path) = if let Some(rest) = r.strip_prefix("https://").or_else(|| r.strip_prefix("http://")) {
        rest.split_once('/')?
    } else if let Some(rest) = r.strip_prefix("ssh://") {
        let (host, path) = rest.split_once('/')?;
        (host.split(':').next()?, path)
    } else {
        // scp form: [user@]host:path
        let (host, path) = r.split_once(':')?;
        if host.contains('/') {
            return None;
        }
        (host, path)
    };
    let host = host.rsplit('@').next()?;
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some(format!("https://{host}/{}", path.trim_start_matches('/')))
}

/// Percent-encodes a path for a URL; the slashes stay.
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Opens an https link in the default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links open.".into());
    }
    Command::new("/usr/bin/open").arg(&url).status().map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_v2() {
        let text = "# branch.oid 1234abcd\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -2\0\
1 .M N... 100644 100644 100644 aa bb src/a b.rs\0\
2 R. N... 100644 100644 100644 aa bb R100 new.rs\0old.rs\0\
u UU N... 100644 100644 100644 100644 aa bb cc conflict.rs\0\
? notes.txt\0";
        let st = parse_status(text, "/r");
        assert_eq!((st.branch.as_str(), st.head.as_str(), st.ahead, st.behind), ("main", "1234abcd", 1, 2));
        assert_eq!(
            st.files,
            vec![("/r/src/a b.rs".into(), 'M'), ("/r/new.rs".into(), 'R'), ("/r/conflict.rs".into(), 'M'), ("/r/notes.txt".into(), 'U')]
        );
        assert_eq!(st.dirty, 4);

        let st = parse_status("# branch.oid (initial)\0# branch.head dev\0", "/r");
        assert_eq!((st.branch.as_str(), st.head.as_str()), ("dev", ""));
        let st = parse_status("# branch.oid ab\0# branch.head (detached)\0", "/r");
        assert_eq!(st.branch, "detached");
    }

    #[test]
    fn web_urls() {
        let gh = Some("https://github.com/org/repo".to_string());
        assert_eq!(web_url("git@github.com:org/repo.git"), gh);
        assert_eq!(web_url("https://github.com/org/repo.git"), gh);
        assert_eq!(web_url("https://user:token@github.com/org/repo"), gh);
        assert_eq!(web_url("ssh://git@github.com:22/org/repo.git"), gh);
        assert_eq!(web_url("ssh://git@github.com/org/repo"), gh);
        assert_eq!(web_url("/local/path/repo"), None);
        assert_eq!(encode("src/a b#c.ts"), "src/a%20b%23c.ts");
    }

    #[test]
    fn codes() {
        assert_eq!(code("??"), 'U');
        assert_eq!(code(" M"), 'M');
        assert_eq!(code("MM"), 'M');
        assert_eq!(code("A"), 'A');
        assert_eq!(code(" D"), 'D');
        assert_eq!(code("R"), 'R');
    }
}
