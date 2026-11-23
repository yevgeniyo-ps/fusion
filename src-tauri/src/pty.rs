// Shells in real PTYs. A project tab's shell starts in the tab folder (tab.rs), with the
// claude wrapper first on PATH. A terminal tab's panes are plain shells in the home folder.

use crate::projects::{err, home};
use crate::session;
use crate::tab::tab_dir;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PtyEvent {
    Data { data: String },
    Exit,
}

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys(Mutex<HashMap<String, Pty>>);

impl Ptys {
    pub fn kill(&self, id: &str) {
        if let Some(mut p) = self.0.lock().unwrap().remove(id) {
            let _ = p.child.kill();
        }
    }
}

/// Text from the bytes read so far. A UTF-8 character can be split across two reads: its
/// first bytes stay in `carry` until the rest arrive.
fn decode(carry: &mut Vec<u8>, chunk: &[u8]) -> String {
    carry.extend_from_slice(chunk);
    match std::str::from_utf8(carry) {
        Ok(s) => {
            let s = s.to_owned();
            carry.clear();
            s
        }
        // Only an incomplete character at the end: keep it for the next read.
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let s = String::from_utf8_lossy(&carry[..valid]).into_owned();
            carry.drain(..valid);
            s
        }
        Err(_) => {
            let s = String::from_utf8_lossy(carry).into_owned();
            carry.clear();
            s
        }
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    ptys: State<Ptys>,
    id: String,
    cols: u16,
    rows: u16,
    // A plain shell: the home folder, no tab folder, no claude wrapper.
    plain: bool,
    // Session restore: the folder to start in, and the command to run again in it.
    cwd: Option<String>,
    run: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<(), String> {
    ptys.kill(&id);
    let dir = if plain { home() } else { tab_dir(&app, &id)? };
    let meta = dir.join(".fusion");
    if !plain && !meta.exists() {
        return Err("the tab folder is not ready".into());
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    let start = cwd.map(std::path::PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(|| dir.clone());
    cmd.cwd(&start);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Fusion");
    // An app opened from the Finder has no LANG, and claude then draws boxes as "?".
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if plain {
        // The user's own startup files, as in iTerm.
    } else if shell.ends_with("zsh") {
        cmd.env("FUSION_TAB_DIR", &dir);
        let user = std::env::var_os("ZDOTDIR").map_or_else(home, Into::into);
        cmd.env("FUSION_USER_ZDOTDIR", user);
        cmd.env("ZDOTDIR", meta.join("zdotdir"));
    } else {
        cmd.env("FUSION_TAB_DIR", &dir);
        // Other shells: bin/ first now; the user's startup files can still move it.
        let path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{}:{path}", meta.join("bin").display()));
    }

    let child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let mut writer = pair.master.take_writer().map_err(err)?;
    // The shell reads this as typed input once it is ready. A sudo command is typed but not
    // run: it must not run again without the user.
    if let Some(line) = run.filter(|l| !l.trim().is_empty()) {
        let enter = if line.trim_start().starts_with("sudo ") { "" } else { "\r" };
        let _ = writer.write_all(format!("{line}{enter}").as_bytes());
    }

    thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut carry = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = decode(&mut carry, &buf[..n]);
                    if !data.is_empty() && on_event.send(PtyEvent::Data { data }).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = on_event.send(PtyEvent::Exit);
    });

    ptys.0.lock().unwrap().insert(id, Pty { master: pair.master, writer, child });
    Ok(())
}

#[derive(Serialize)]
pub struct PtyState {
    cwd: Option<String>,
    command: Option<String>,
}

/// What each shell runs now (session.rs): the frontend saves it for the next start.
#[tauri::command]
pub async fn pty_states(ptys: State<'_, Ptys>) -> Result<HashMap<String, PtyState>, String> {
    let shells: Vec<(String, i32, i32)> = ptys
        .0
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(id, p)| Some((id.clone(), p.child.process_id()? as i32, p.master.process_group_leader().unwrap_or(0))))
        .collect();
    let procs = session::processes();
    Ok(shells
        .into_iter()
        .map(|(id, shell, group)| (id, PtyState { cwd: session::cwd(shell), command: session::foreground(shell, group, &procs) }))
        .collect())
}

/// Stops one shell: a split pane closed.
#[tauri::command]
pub fn pty_kill(ptys: State<Ptys>, id: String) {
    ptys.kill(&id);
}

#[tauri::command]
pub fn pty_write(ptys: State<Ptys>, id: String, data: String) -> Result<(), String> {
    let mut map = ptys.0.lock().unwrap();
    let p = map.get_mut(&id).ok_or("no terminal")?;
    p.writer.write_all(data.as_bytes()).map_err(err)?;
    p.writer.flush().map_err(err)
}

#[tauri::command]
pub fn pty_resize(ptys: State<Ptys>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = ptys.0.lock().unwrap();
    let p = map.get(&id).ok_or("no terminal")?;
    p.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn split_character() {
        let bytes = "a—b".as_bytes();
        let mut carry = Vec::new();
        assert_eq!(decode(&mut carry, &bytes[..2]), "a");
        assert_eq!(decode(&mut carry, &bytes[2..]), "—b");
        assert!(carry.is_empty());
    }
}
