// The Claude plan's usage limits, as Claude Code's /usage shows them: how much of the 5-hour
// session and of the week is used. Read from Anthropic with the Claude Code login on this Mac
// (its OAuth token in the keychain). The token goes to curl on stdin, never on a command line.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Deserialize)]
struct Creds {
    #[serde(rename = "claudeAiOauth")]
    oauth: Token,
}

#[derive(Deserialize)]
struct Token {
    #[serde(rename = "accessToken")]
    access: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Limit {
    /// Percent used, 0–100.
    utilization: f64,
    /// When the limit resets (RFC 3339); unset before the first use.
    resets_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct PlanUsage {
    five_hour: Option<Limit>,
    seven_day: Option<Limit>,
}

fn token() -> Option<String> {
    let out = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let creds: Creds = serde_json::from_slice(&out.stdout).ok()?;
    Some(creds.oauth.access)
}

/// None: not logged in to Claude Code, offline, or the token expired (claude renews it).
#[tauri::command]
pub async fn plan_usage() -> Option<PlanUsage> {
    let token = token()?;
    let mut curl = Command::new("/usr/bin/curl")
        .args(["-sS", "-f", "-m", "10", "-H", "@-", "https://api.anthropic.com/api/oauth/usage"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let headers = format!("Authorization: Bearer {token}\nanthropic-beta: oauth-2025-04-20\n");
    curl.stdin.take()?.write_all(headers.as_bytes()).ok()?;
    let out = curl.wait_with_output().ok().filter(|o| o.status.success())?;
    serde_json::from_slice(&out.stdout).ok()
}
