// Find in files, for a project (VS Code's ⌘⇧F): every line that matches, by file.
//
// The walk honours .gitignore, .ignore and git's excludes (the `ignore` crate, ripgrep's),
// so node_modules and build output stay out; it also works in a folder that is no repo.
// Binary files and big files are skipped, and the results stop at a cap.

use crate::projects::{err, Projects};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use tauri::State;

const MAX_HITS: usize = 2000;
const MAX_PER_FILE: usize = 200;
const MAX_FILE: u64 = 2 * 1024 * 1024;
/// A long line (minified code) is cut to this, around its first match.
const MAX_LINE: usize = 240;

#[derive(Serialize)]
pub struct Hit {
    path: String,
    /// 1-based.
    line: u32,
    /// The line, or the part of a long line around the match.
    text: String,
    /// Where `text` starts in the line, and each match in `text`: UTF-16 offsets, as
    /// JavaScript strings and CodeMirror count.
    offset: u32,
    ranges: Vec<(u32, u32)>,
}

#[derive(Serialize)]
pub struct Found {
    hits: Vec<Hit>,
    files: u32,
    /// The cap was reached: there are more matches.
    truncated: bool,
}

/// UTF-16 length of a str, as JavaScript counts.
fn u16len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// One line's matches: the text to show, its offset in the line, and the match ranges.
fn hit_line(line: &str, spans: &[(usize, usize)]) -> (String, u32, Vec<(u32, u32)>) {
    let (mut start, mut end) = (0, line.len());
    if line.len() > MAX_LINE {
        // A window from a little before the first match, on char boundaries.
        start = spans[0].0.saturating_sub(60);
        while !line.is_char_boundary(start) {
            start -= 1;
        }
        end = (start + MAX_LINE).min(line.len());
        while !line.is_char_boundary(end) {
            end -= 1;
        }
    }
    let text = &line[start..end];
    let ranges = spans
        .iter()
        .filter(|(a, _)| *a >= start && *a < end)
        .map(|&(a, b)| (u16len(&line[start..a]), u16len(&line[start..b.min(end)])))
        .collect();
    (text.trim_end().to_string(), u16len(&line[..start]), ranges)
}

#[tauri::command]
pub async fn search(
    projects: State<'_, Projects>,
    path: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    regex: bool,
) -> Result<Found, String> {
    let root = projects.guard(&path)?;
    if query.is_empty() {
        return Ok(Found { hits: vec![], files: 0, truncated: false });
    }
    let mut pattern = if regex { query } else { regex::escape(&query) };
    if whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    let re = RegexBuilder::new(&pattern).case_insensitive(!case_sensitive).build().map_err(|e| format!("Not a valid regular expression: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut found = Found { hits: vec![], files: 0, truncated: false };
        // Hidden files count (.github, .env.example); the .git folder does not.
        let walk = WalkBuilder::new(&root).hidden(false).filter_entry(|e| e.file_name() != ".git").build();
        'files: for entry in walk.flatten() {
            if !entry.file_type().is_some_and(|t| t.is_file()) || entry.metadata().map_or(true, |m| m.len() > MAX_FILE) {
                continue;
            }
            let Ok(bytes) = fs::read(entry.path()) else { continue };
            if bytes.iter().take(8192).any(|&b| b == 0) {
                continue;
            }
            let Ok(text) = std::str::from_utf8(&bytes) else { continue };
            let mut in_file = 0;
            for (i, line) in text.lines().enumerate() {
                let spans: Vec<(usize, usize)> = re.find_iter(line).filter(|m| m.end() > m.start()).map(|m| (m.start(), m.end())).collect();
                if spans.is_empty() {
                    continue;
                }
                if in_file == 0 {
                    found.files += 1;
                }
                let (text, offset, ranges) = hit_line(line, &spans);
                found.hits.push(Hit { path: entry.path().to_string_lossy().into_owned(), line: i as u32 + 1, text, offset, ranges });
                in_file += 1;
                if found.hits.len() >= MAX_HITS {
                    found.truncated = true;
                    break 'files;
                }
                if in_file >= MAX_PER_FILE {
                    break;
                }
            }
        }
        Ok(found)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_are_utf16_and_long_lines_are_cut() {
        // "é" is one UTF-16 unit but two bytes; "😀" is two units and four bytes.
        let line = "é😀 total";
        let at = line.find("total").unwrap();
        let (text, offset, ranges) = hit_line(line, &[(at, at + 5)]);
        assert_eq!((text.as_str(), offset, ranges), ("é😀 total", 0, vec![(4, 9)]));

        let long = format!("{}needle{}", "x".repeat(500), "y".repeat(500));
        let at = long.find("needle").unwrap();
        let (text, offset, ranges) = hit_line(&long, &[(at, at + 6)]);
        assert!(text.len() <= MAX_LINE);
        assert_eq!(offset, 440);
        assert_eq!(&text[ranges[0].0 as usize..ranges[0].1 as usize], "needle");
    }
}

#[cfg(test)]
mod real_repo {
    /// The walk on this repo: .gitignore keeps node_modules and target out.
    #[test]
    fn this_repo() {
        use ignore::WalkBuilder;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let files: Vec<_> = WalkBuilder::new(root).hidden(false).filter_entry(|e| e.file_name() != ".git").build().flatten().filter(|e| e.file_type().is_some_and(|t| t.is_file())).map(|e| e.path().to_path_buf()).collect();
        assert!(files.iter().any(|p| p.ends_with("src/components/SearchPanel.tsx")));
        assert!(!files.iter().any(|p| p.components().any(|c| c.as_os_str() == "node_modules" || c.as_os_str() == "target" || c.as_os_str() == ".git")));
        println!("searched {} files", files.len());
    }
}
