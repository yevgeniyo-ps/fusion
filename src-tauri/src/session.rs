// What each shell runs now, so Fusion can start it again after a restart (as iTerm restores
// sessions): the shell's working folder and its foreground command, with exact arguments.
//
// The foreground job is the PTY's foreground process group. Its processes whose parent is
// the shell are the job's pipeline (`tail -f x | grep y`); their children (npm's node) are not.

use std::ffi::CStr;
use std::process::Command;

/// The working folder of a process.
pub fn cwd(pid: i32) -> Option<String> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as i32;
    let got = unsafe {
        libc::proc_pidinfo(pid, libc::PROC_PIDVNODEPATHINFO, 0, &mut info as *mut _ as *mut libc::c_void, size)
    };
    if got != size {
        return None;
    }
    // vip_path is char[MAXPATHLEN], declared in libc as [[c_char; 32]; 32].
    let path = unsafe { CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr() as *const libc::c_char) };
    Some(path.to_string_lossy().into_owned()).filter(|p| !p.is_empty())
}

/// A process's arguments, as the kernel keeps them (KERN_PROCARGS2): argc, the exec path,
/// padding, then argv, each ending in NUL.
pub fn argv(pid: i32) -> Option<Vec<String>> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut size: libc::size_t = 0;
    let null = std::ptr::null_mut();
    if unsafe { libc::sysctl(mib.as_mut_ptr(), 3, null, &mut size, null, 0) } != 0 {
        return None;
    }
    let mut buf = vec![0u8; size];
    if unsafe { libc::sysctl(mib.as_mut_ptr(), 3, buf.as_mut_ptr() as *mut libc::c_void, &mut size, null, 0) } != 0 {
        return None;
    }
    buf.truncate(size);
    parse_procargs(&buf)
}

fn parse_procargs(buf: &[u8]) -> Option<Vec<String>> {
    let argc = i32::from_ne_bytes(buf.get(..4)?.try_into().ok()?) as usize;
    let rest = &buf[4..];
    let rest = &rest[rest.iter().position(|&b| b == 0)?..]; // past the exec path
    let rest = &rest[rest.iter().position(|&b| b != 0)?..]; // past the padding
    let args: Vec<String> = rest.split(|&b| b == 0).take(argc).map(|s| String::from_utf8_lossy(s).into_owned()).collect();
    (args.len() == argc && argc > 0).then_some(args)
}

/// An argument as the shell reads it back: plain when it is safe, else in single quotes.
pub fn quote(arg: &str) -> String {
    let plain = !arg.is_empty() && arg.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-./=:,@%+".contains(&b));
    if plain {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', r"'\''"))
    }
}

/// One command line for argv. The tab's claude wrapper (`bash …/.fusion/bin/claude`) is
/// `claude`: run again, it resumes the tab's session.
fn command_line(args: &[String]) -> String {
    let args = match args {
        [sh, script, rest @ ..] if sh.ends_with("bash") && script.ends_with("/.fusion/bin/claude") => {
            std::iter::once("claude".to_string()).chain(rest.iter().cloned()).collect::<Vec<_>>()
        }
        _ => args.to_vec(),
    };
    args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ")
}

/// pid, ppid and pgid of every process.
pub fn processes() -> Vec<(i32, i32, i32)> {
    let Ok(out) = Command::new("/bin/ps").args(["-A", "-o", "pid=,ppid=,pgid="]).output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut n = l.split_whitespace().map(|x| x.parse::<i32>().ok());
            Some((n.next()??, n.next()??, n.next()??))
        })
        .collect()
}

/// The shell's foreground job as one command line; None when the shell itself is in front.
pub fn foreground(shell: i32, group: i32, procs: &[(i32, i32, i32)]) -> Option<String> {
    if group <= 0 || group == shell {
        return None;
    }
    let mut members: Vec<i32> = procs.iter().filter(|p| p.2 == group && p.1 == shell).map(|p| p.0).collect();
    if members.is_empty() {
        members.push(group);
    }
    members.sort_unstable();
    let parts: Vec<String> = members.iter().filter_map(|&pid| argv(pid)).map(|a| command_line(&a)).collect();
    (!parts.is_empty()).then(|| parts.join(" | "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting() {
        assert_eq!(quote("kubectl"), "kubectl");
        assert_eq!(quote("-n=kube-system"), "-n=kube-system");
        assert_eq!(quote("kubectl get pods"), "'kubectl get pods'");
        assert_eq!(quote("it's"), r"'it'\''s'");
        assert_eq!(quote(""), "''");
    }

    #[test]
    fn claude_wrapper() {
        let a = ["/bin/bash", "/x/tabs/1/.fusion/bin/claude", "--model", "opus"].map(String::from);
        assert_eq!(command_line(&a), "claude --model opus");
        let w = ["watch", "-n", "2", "kubectl get nodes"].map(String::from);
        assert_eq!(command_line(&w), "watch -n 2 'kubectl get nodes'");
    }

    #[test]
    fn procargs() {
        let mut buf = 2i32.to_ne_bytes().to_vec();
        buf.extend_from_slice(b"/usr/bin/watch\0\0\0watch\0kubectl get nodes\0PATH=/bin\0");
        assert_eq!(parse_procargs(&buf).unwrap(), vec!["watch", "kubectl get nodes"]);
    }

    #[test]
    fn this_process() {
        // The test binary itself: its folder and its arguments are readable.
        let me = std::process::id() as i32;
        assert_eq!(cwd(me).unwrap(), std::env::current_dir().unwrap().to_string_lossy());
        assert!(argv(me).unwrap()[0].contains("fusion"));
    }

    #[test]
    fn foreground_job_in_a_pty() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Write;
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/zsh");
        cmd.args(["-f", "-i"]);
        cmd.cwd("/tmp");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        let shell = child.process_id().unwrap() as i32;
        let mut w = pair.master.take_writer().unwrap();
        // Read the output as the app does: a full PTY buffer would stop the shell.
        let mut r = pair.master.try_clone_reader().unwrap();
        std::thread::spawn(move || {
            let mut b = [0u8; 4096];
            while matches!(std::io::Read::read(&mut r, &mut b), Ok(n) if n > 0) {}
        });
        // Typed at once, as pty_spawn types a restored command: zsh keeps it until it reads.
        std::thread::sleep(std::time::Duration::from_millis(50));
        w.write_all(b"cd /usr && sleep 30 | cat\r").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let group = pair.master.process_group_leader().unwrap();
        let found = foreground(shell, group, &processes());
        let folder = cwd(shell);
        let _ = child.kill();
        assert_eq!(found.as_deref(), Some("sleep 30 | cat"));
        assert_eq!(folder.as_deref(), Some("/usr"));
    }
}
