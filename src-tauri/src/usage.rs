// Claude tokens per terminal, from Claude Code's transcripts:
// <config>/projects/<cwd, non-alphanumerics as "-">/<session id>.jsonl. Each reply ("assistant"
// line) carries its usage; one reply is written as several lines (one per content block) with
// the same message id and the same usage, so a reply counts once, by its id.
//
// A project tab's claude has a known session id (the wrapper's .fusion/session): its count
// is exact. In another terminal, the newest transcript of its folder is the running claude's.
// Transcripts grow to megabytes: each file is read once, then only what was added since.

use crate::projects::{err, home};
use crate::tab::tab_dir;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Default, Clone)]
pub struct Usage {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    /// Replies counted.
    replies: u32,
    /// The model of the last reply.
    model: String,
    /// What these tokens would cost on the Claude API at list prices, in US dollars.
    cost: f64,
    /// Replies whose model has no price here: their tokens count, their cost does not.
    unpriced: u32,
}

/// One reply's usage.
#[derive(Clone, Default)]
struct Reply {
    input: u64,
    output: u64,
    cache_read: u64,
    /// Cache writes by lifetime: 5 minutes and 1 hour cost differently.
    write_5m: u64,
    write_1h: u64,
    model: String,
    fast: bool,
}

#[derive(Default)]
struct FileState {
    offset: u64,
    /// A line not finished yet at the end of the last read.
    carry: Vec<u8>,
    by_id: HashMap<String, Reply>,
    model: String,
}

/// List prices per million tokens: input, output, cache read. From the Claude API pricing
/// (claude-api skill, models table cached 2026-10-06). Cache writes are 1.25x input for the
/// 5-minute lifetime and 2x for the hour; cache reads are 0.1x input except where noted.
fn prices(model: &str, prompt: u64) -> Option<(f64, f64, f64)> {
    Some(match model {
        // Cache reads: 0.025x on Fable 5.1 / Mythos 5.1.
        "claude-fable-5-1" | "claude-mythos-5-1" => (10.0, 50.0, 0.25),
        "claude-fable-5" | "claude-mythos-5" => (10.0, 50.0, 1.0),
        // Cache reads: 0.05x on Opus 5.5.
        "claude-opus-5-5" => (4.0, 20.0, 0.20),
        "claude-opus-5" | "claude-opus-4-8" | "claude-opus-4-7" | "claude-opus-4-6" => (5.0, 25.0, 0.50),
        "claude-sonnet-5-5" | "claude-sonnet-5" => (2.0, 10.0, 0.20),
        "claude-sonnet-4-6" => (3.0, 15.0, 0.30),
        // Haiku 5.5: a higher price once the prompt is over 100K tokens.
        "claude-haiku-5-5" if prompt > 100_000 => (0.50, 2.50, 0.05),
        "claude-haiku-5-5" => (0.10, 0.50, 0.01),
        "claude-haiku-4-5" => (1.0, 5.0, 0.10),
        _ => return None,
    })
}

/// A transcript's model id as the price table names it: no "[1m]"-style suffix, no date,
/// no platform prefix ("us.anthropic.", "anthropic.") or "@date".
fn model_key(model: &str) -> String {
    let m = model.to_ascii_lowercase();
    let m = m.split('[').next().unwrap_or(&m);
    let m = m.split('@').next().unwrap_or(m);
    let m = m.rsplit("anthropic.").next().unwrap_or(m);
    match m.rsplit_once('-') {
        Some((head, date)) if date.len() == 8 && date.bytes().all(|b| b.is_ascii_digit()) => head.to_string(),
        _ => m.to_string(),
    }
}

/// One reply at list prices; None for a model with no price here.
fn cost(r: &Reply) -> Option<f64> {
    let model = model_key(&r.model);
    let prompt = r.input + r.cache_read + r.write_5m + r.write_1h;
    let (i, o, read) = prices(&model, prompt)?;
    // Fast mode (Claude API, Opus 5.5 and Opus 5): twice the standard price.
    let k = if r.fast && (model == "claude-opus-5-5" || model == "claude-opus-5") { 2.0 } else { 1.0 };
    let dollars = r.input as f64 * i + r.output as f64 * o + r.cache_read as f64 * read + r.write_5m as f64 * i * 1.25 + r.write_1h as f64 * i * 2.0;
    Some(dollars * k / 1e6)
}

#[derive(Default)]
pub struct UsageCache(Mutex<HashMap<PathBuf, FileState>>);

fn config_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map_or_else(|| home().join(".claude"), PathBuf::from)
}

/// Claude Code's folder name for a working directory.
fn folder_name(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn newest_jsonl(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max_by_key(|(t, _)| *t)
        .map(|(_, p)| p)
}

fn transcript(app: &AppHandle, id: &str, plain: bool, cwd: Option<&str>) -> Option<PathBuf> {
    let projects = config_dir().join("projects");
    if plain {
        return newest_jsonl(&projects.join(folder_name(cwd?)));
    }
    let dir = tab_dir(app, id).ok()?;
    let sid = fs::read_to_string(dir.join(".fusion/session")).ok()?;
    let file = format!("{}.jsonl", sid.trim());
    let direct = projects.join(folder_name(&dir.to_string_lossy())).join(&file);
    if direct.exists() {
        return Some(direct);
    }
    // The folder name rule is Claude Code's: if it ever changes, the session id still finds it.
    fs::read_dir(&projects).ok()?.flatten().map(|e| e.path().join(&file)).find(|p| p.exists())
}

fn add_line(st: &mut FileState, line: &[u8]) {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(line) else { return };
    if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
        return;
    }
    let Some(msg) = v.get("message") else { return };
    let (Some(id), Some(u)) = (msg.get("id").and_then(|i| i.as_str()), msg.get("usage")) else { return };
    let model = msg.get("model").and_then(|m| m.as_str()).unwrap_or_default();
    // Claude Code's own placeholder replies (errors, interrupts) are not model calls.
    if model == "<synthetic>" {
        return;
    }
    let n = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let written = n(u, "cache_creation_input_tokens");
    // The split by lifetime, when the transcript has it; else all of it is the 5-minute kind.
    let (write_5m, write_1h) = match u.get("cache_creation") {
        Some(c) => (n(c, "ephemeral_5m_input_tokens"), n(c, "ephemeral_1h_input_tokens")),
        None => (written, 0),
    };
    let reply = Reply {
        input: n(u, "input_tokens"),
        output: n(u, "output_tokens"),
        cache_read: n(u, "cache_read_input_tokens"),
        write_5m: if write_5m + write_1h == written { write_5m } else { written - write_1h.min(written) },
        write_1h: write_1h.min(written),
        model: model.to_string(),
        fast: u.get("speed").and_then(|s| s.as_str()) == Some("fast"),
    };
    st.by_id.insert(id.to_string(), reply);
    if !model.is_empty() {
        st.model = model.to_string();
    }
}

/// Reads what the transcript gained since the last call, and returns the totals.
fn read(cache: &UsageCache, path: &Path) -> Result<Usage, String> {
    let mut map = cache.0.lock().unwrap();
    let st = map.entry(path.to_path_buf()).or_default();
    let mut f = fs::File::open(path).map_err(err)?;
    let len = f.metadata().map_err(err)?.len();
    if len < st.offset {
        // Rewritten from the start: count again.
        *st = FileState::default();
    }
    if len > st.offset {
        f.seek(SeekFrom::Start(st.offset)).map_err(err)?;
        let mut buf = std::mem::take(&mut st.carry);
        f.take(len - st.offset).read_to_end(&mut buf).map_err(err)?;
        st.offset = len;
        let mut lines: Vec<&[u8]> = buf.split(|&b| b == b'\n').collect();
        let rest = lines.pop().unwrap_or_default().to_vec();
        for line in lines {
            add_line(st, line);
        }
        st.carry = rest;
    }
    let mut u = Usage { replies: st.by_id.len() as u32, model: st.model.clone(), ..Default::default() };
    for r in st.by_id.values() {
        u.input += r.input;
        u.output += r.output;
        u.cache_read += r.cache_read;
        u.cache_write += r.write_5m + r.write_1h;
        match cost(r) {
            Some(c) => u.cost += c,
            None => u.unpriced += 1,
        }
    }
    Ok(u)
}

/// The tokens of a terminal's claude session; None when it has no transcript yet.
#[tauri::command]
pub async fn claude_usage(app: AppHandle, id: String, plain: bool, cwd: Option<String>) -> Result<Option<Usage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = transcript(&app, &id, plain, cwd.as_deref()) else { return Ok(None) };
        read(&app.state::<UsageCache>(), &path).map(Some)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names() {
        assert_eq!(folder_name("/Users/a.b/code/fusion"), "-Users-a-b-code-fusion");
        assert_eq!(folder_name("/x/Application Support/y"), "-x-Application-Support-y");
    }

    #[test]
    fn model_keys_and_prices() {
        assert_eq!(model_key("claude-opus-5-5"), "claude-opus-5-5");
        assert_eq!(model_key("claude-opus-5-5[1m]"), "claude-opus-5-5");
        assert_eq!(model_key("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
        assert_eq!(model_key("us.anthropic.claude-sonnet-4-6"), "claude-sonnet-4-6");
        // 1M input + 1M output + 1M cache read + 1M 5m-write + 1M 1h-write on Opus 5.5:
        // 4 + 20 + 0.20 + 5 + 8 = 37.20
        let r = Reply { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, write_5m: 1_000_000, write_1h: 1_000_000, model: "claude-opus-5-5".into(), fast: false };
        assert!((cost(&r).unwrap() - 37.20).abs() < 1e-9);
        assert!((cost(&Reply { fast: true, ..r.clone() }).unwrap() - 74.40).abs() < 1e-9);
        // Haiku 5.5 over 100K tokens of prompt: the higher price.
        let h = Reply { input: 200_000, model: "claude-haiku-5-5".into(), ..Default::default() };
        assert!((cost(&h).unwrap() - 0.10).abs() < 1e-9);
        assert!(cost(&Reply { model: "claude-3-opus".into(), ..Default::default() }).is_none());
    }

    #[test]
    fn one_reply_counts_once_and_lines_can_arrive_in_parts() {
        let dir = std::env::temp_dir().join(format!("fusion-usage-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let reply = |id: &str, out: u64| {
            format!(r#"{{"type":"assistant","message":{{"id":"{id}","model":"claude-x","usage":{{"input_tokens":10,"output_tokens":{out},"cache_read_input_tokens":100,"cache_creation_input_tokens":5}}}}}}"#)
        };
        // One reply on two lines (two content blocks), then half of a second reply's line.
        let first = format!("{}\n{}\n{{\"type\":\"user\"}}\n", reply("m1", 20), reply("m1", 20));
        let second = reply("m2", 7);
        let (head, tail) = second.split_at(30);
        fs::write(&path, format!("{first}{head}")).unwrap();
        let cache = UsageCache::default();
        let u = read(&cache, &path).unwrap();
        assert_eq!((u.replies, u.input, u.output, u.cache_read, u.cache_write), (1, 10, 20, 100, 5));
        // The rest of the line arrives: the second reply counts, the first still once.
        let mut f = fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut f, format!("{tail}\n").as_bytes()).unwrap();
        let u = read(&cache, &path).unwrap();
        assert_eq!((u.replies, u.input, u.output), (2, 20, 27));
        assert_eq!(u.model, "claude-x");
        let _ = fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod real_file {
    /// FUSION_USAGE_FILE=<transcript> cargo test real_transcript -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_transcript() {
        let p = std::path::PathBuf::from(std::env::var("FUSION_USAGE_FILE").unwrap());
        let u = super::read(&super::UsageCache::default(), &p).unwrap();
        println!("rust: {} [{}, {}, {}, {}] ${:.4} unpriced {}", u.replies, u.input, u.output, u.cache_read, u.cache_write, u.cost, u.unpriced);
    }
}
